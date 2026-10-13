// Integration tests for the "Log workout" screen: the real app from src/app/, signed in, with a
// fake backend.
import type { CreateWorkoutBody, Exercise, WorkoutDetail } from '@shared/models';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { TOKEN_KEY } from '@/auth/token-storage';
import { recordAlerts } from '@/test-utils/alerts';
import { doubleTap } from '@/test-utils/double-tap';
import { jsonResponse, mockApi, requestsMade } from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');
// The native date picker can't render in Jest (it's a SwiftUI / Jetpack Compose view). This
// stand-in is a plain View that keeps every prop, so a test could fire its onValueChange.
// jest.mock factories run before the imports, so they load what they need with
// jest.requireActual; the type argument gives the result the module's real type.
jest.mock('@expo/ui/community/datetime-picker', () => {
  const { createElement } = jest.requireActual<typeof import('react')>('react');
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  const DateTimePicker = (props: object) => createElement(View, props);
  return { __esModule: true, DateTimePicker, default: DateTimePicker };
});

// 05:30 UTC on Wednesday 14 October is 22:30 on Tuesday the 13th in Los Angeles, the zone Jest
// runs in (jest.global-setup.js). The phone's "today" is the 13th; UTC's would be the 14th.
const NOW = new Date('2026-10-14T05:30:00Z');

const EXERCISES: Exercise[] = [
  { id: 1, name: 'Bench Press', muscle_group: 'Chest', created_by: null },
  { id: 2, name: 'Squat', muscle_group: 'Legs', created_by: null },
  { id: 3, name: 'Deadlift', muscle_group: 'Back', created_by: null },
];

// A backend that saves one new workout (id 7) and then serves it in the history and as detail.
// `holdSave()` keeps the POST unanswered until the returned function is called.
function fakeServer() {
  const saved: CreateWorkoutBody[] = [];
  let gate: Promise<void> | null = null;

  function workout(): WorkoutDetail | null {
    const body = saved[0];
    if (!body) return null;
    return {
      id: 7,
      date: body.date ?? '',
      notes: body.notes ?? null,
      sets: body.sets.map((s, i) => ({
        id: 70 + i,
        exercise_id: s.exercise_id,
        exercise_name: EXERCISES.find((e) => e.id === s.exercise_id)?.name ?? '?',
        set_number: s.set_number,
        reps: s.reps,
        weight: s.weight.toFixed(2),
        unit: s.unit ?? 'lb',
      })),
    };
  }

  const fetchMock = mockApi({
    'GET /workouts': () => {
      const w = workout();
      return jsonResponse(200, w ? [w] : []);
    },
    'GET /exercises': () => jsonResponse(200, EXERCISES),
    'POST /workouts': async ({ body }) => {
      await gate;
      // `as`: the fake trusts the app's body; the tests check it exactly through `saved`.
      saved.push(body as CreateWorkoutBody);
      return jsonResponse(201, { id: 7 });
    },
    'GET /workouts/7': () => jsonResponse(200, workout()),
  });

  function holdSave(): () => void {
    let release = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });
    return () => {
      gate = null;
      release();
    };
  }

  return { saved, fetchMock, holdSave };
}

beforeEach(async () => {
  await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
  // renderRouter switches to fake timers but keeps the current time, so setting it here sticks.
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// Starts on the history and opens the log screen with its header button, like a user.
// See auth-screens.test.tsx for why the Promise is awaited separately.
async function openLogScreen() {
  const rendered = renderRouter('./src/app', { initialUrl: '/' });
  await rendered;
  await fireEvent.press(await screen.findByRole('button', { name: 'Log workout' }));
  await waitFor(() => expect(rendered.getPathname()).toBe('/workouts/new'));
  return { getPathname: () => rendered.getPathname() };
}

// Opens the picker, searches, and picks `name`.
async function addExercise(name: string, search = '') {
  await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
  if (search) {
    await fireEvent.changeText(await screen.findByLabelText('Search exercises'), search);
  }
  await fireEvent.press(await screen.findByRole('button', { name }));
  await screen.findByTestId(`${name} card`);
}

async function fillSet(name: string, n: number, reps: string, weight: string) {
  await fireEvent.changeText(screen.getByLabelText(`${name} set ${n} reps`), reps);
  await fireEvent.changeText(screen.getByLabelText(`${name} set ${n} weight`), weight);
}

it('logs a workout end to end and opens it, with back going to the updated history', async () => {
  const { saved, fetchMock } = fakeServer();
  const app = await openLogScreen();

  // Search narrows the list.
  await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
  await fireEvent.changeText(await screen.findByLabelText('Search exercises'), 'squ');
  expect(screen.queryByRole('button', { name: 'Bench Press' })).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Squat' }));

  await fillSet('Squat', 1, '5', '225');
  // + Add set copies the previous set; then the copy's reps are changed.
  await fireEvent.press(screen.getByRole('button', { name: 'Add Squat set' }));
  expect(screen.getByLabelText('Squat set 2 weight')).toHaveDisplayValue('225');
  await fireEvent.changeText(screen.getByLabelText('Squat set 2 reps'), '3');

  await addExercise('Bench Press');
  await fillSet('Bench Press', 1, '8', '60,5');
  await fireEvent.press(
    within(screen.getByLabelText('Bench Press set 1 unit')).getByRole('radio', { name: 'kg' })
  );
  await fireEvent.changeText(screen.getByLabelText('Notes'), ' Heavy day ');

  await fireEvent.press(screen.getByRole('button', { name: 'Save workout' }));

  await waitFor(() => expect(app.getPathname()).toBe('/workouts/7'));
  expect(saved).toEqual([
    {
      date: '2026-10-13',
      notes: 'Heavy day',
      sets: [
        { exercise_id: 2, set_number: 1, reps: 5, weight: 225, unit: 'lb' },
        { exercise_id: 2, set_number: 2, reps: 3, weight: 225, unit: 'lb' },
        { exercise_id: 1, set_number: 1, reps: 8, weight: 60.5, unit: 'kg' },
      ],
    },
  ]);
  expect(await screen.findByText('Tue, Oct 13, 2026')).toBeOnTheScreen();

  // The log screen was replaced, so back goes straight to the history, which has refetched.
  await act(() => router.back());
  expect(app.getPathname()).toBe('/');
  expect(await screen.findByRole('button', { name: /Tue, Oct 13, Squat, Bench Press, 3 sets/ })).toBeOnTheScreen();
  expect(requestsMade(fetchMock).filter((r) => r === 'GET /workouts').length).toBeGreaterThanOrEqual(2);
});

it('removes a set and an exercise before saving', async () => {
  const { saved } = fakeServer();
  await openLogScreen();
  await addExercise('Squat');
  await fillSet('Squat', 1, '5', '225');
  await fireEvent.press(screen.getByRole('button', { name: 'Add Squat set' }));
  await addExercise('Deadlift');

  await fireEvent.press(screen.getByRole('button', { name: 'Remove Squat set 1' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Remove Deadlift' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save workout' }));

  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]?.sets).toEqual([{ exercise_id: 2, set_number: 1, reps: 5, weight: 225, unit: 'lb' }]);
});

it('shows validation errors next to the fields and saves nothing while any set is invalid', async () => {
  const { fetchMock } = fakeServer();
  await openLogScreen();
  await addExercise('Squat');
  const save = screen.getByRole('button', { name: 'Save workout' });
  expect(save).toBeDisabled();

  // An invalid value shows its error as soon as it's typed, and Save stays disabled.
  await fillSet('Squat', 1, '5', '1.234');
  expect(screen.getByText(/at most 2 decimals/)).toBeOnTheScreen();
  expect(save).toBeDisabled();

  await fireEvent.changeText(screen.getByLabelText('Squat set 1 weight'), '100');
  expect(screen.queryByText(/at most 2 decimals/)).not.toBeOnTheScreen();
  expect(save).toBeEnabled();

  // An empty field only shows its error once Save is pressed.
  await fireEvent.press(screen.getByRole('button', { name: 'Add Squat set' }));
  await fireEvent.changeText(screen.getByLabelText('Squat set 2 reps'), '');
  expect(screen.queryByText('Reps must be a whole number.')).not.toBeOnTheScreen();
  await fireEvent.press(save);

  expect(await screen.findByText('Reps must be a whole number.')).toBeOnTheScreen();
  expect(requestsMade(fetchMock)).not.toContain('POST /workouts');
});

it('leaves without asking when nothing was entered', async () => {
  fakeServer();
  const dialogs = recordAlerts();
  const app = await openLogScreen();

  await act(() => router.back());

  expect(app.getPathname()).toBe('/');
  expect(dialogs.spy).not.toHaveBeenCalled();
});

it('asks "Discard this workout?" before leaving with unsaved changes', async () => {
  fakeServer();
  const dialogs = recordAlerts();
  const app = await openLogScreen();
  await addExercise('Squat');

  // Keep editing: the screen stays.
  await act(() => router.back());
  expect(dialogs.spy).toHaveBeenCalledWith(
    'Discard this workout?',
    expect.any(String),
    expect.any(Array),
    expect.anything()
  );
  await dialogs.answer('Keep editing');
  expect(app.getPathname()).toBe('/workouts/new');
  expect(screen.getByTestId('Squat card')).toBeOnTheScreen();

  // Discard: back to the history.
  await act(() => router.back());
  await dialogs.answer('Discard');
  await waitFor(() => expect(app.getPathname()).toBe('/'));
});

it('sends one request when Save is double-tapped', async () => {
  const { fetchMock, holdSave } = fakeServer();
  const app = await openLogScreen();
  await addExercise('Squat');
  await fillSet('Squat', 1, '5', '225');
  const release = holdSave();

  await doubleTap(screen.getByRole('button', { name: 'Save workout' }));
  release();

  await waitFor(() => expect(app.getPathname()).toBe('/workouts/7'));
  expect(requestsMade(fetchMock).filter((r) => r === 'POST /workouts')).toHaveLength(1);
});
