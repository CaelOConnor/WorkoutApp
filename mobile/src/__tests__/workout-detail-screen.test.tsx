// Integration tests for the workout detail screen and its sheets: the real app from src/app/,
// signed in, with a fake backend that remembers changes.
import type {
  AddSetBody,
  Exercise,
  UpdateWorkoutBody,
  WorkoutDetail,
  WorkoutDetailSet,
} from '@shared/models';
import { router, type Href } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import { Alert, type AlertButton } from 'react-native';

import { TOKEN_KEY } from '@/auth/token-storage';
import { recordAlerts } from '@/test-utils/alerts';
import { doubleTap } from '@/test-utils/double-tap';
import {
  jsonResponse,
  mockApi,
  noContentResponse,
  requestsMade,
  type MockRoutes,
} from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');

const SQUAT = { exercise_id: 1, exercise_name: 'Squat' };
const BENCH = { exercise_id: 2, exercise_name: 'Bench Press' };

// GET /exercises: the two in the workout, plus one that isn't.
const EXERCISES: Exercise[] = [
  { id: 1, name: 'Squat', muscle_group: 'Legs', created_by: null },
  { id: 2, name: 'Bench Press', muscle_group: 'Chest', created_by: null },
  { id: 3, name: 'Deadlift', muscle_group: 'Back', created_by: null },
];

// Squat, Squat, Bench. Bench's stored set_number is 3, but it's shown as its card's "Set 1".
function initialWorkout(): WorkoutDetail {
  return {
    id: 3,
    date: '2026-10-14',
    notes: 'Heavy day',
    sets: [
      { id: 31, set_number: 1, reps: 5, weight: 225, unit: 'lb', ...SQUAT },
      { id: 32, set_number: 2, reps: 5, weight: 235, unit: 'lb', ...SQUAT },
      { id: 33, set_number: 3, reps: 8, weight: 135, unit: 'lb', ...BENCH },
    ],
  };
}

// A tiny in-memory backend for workout 3: writes change `state.workout`, and every GET returns
// the current state, so the screen's refetch after a change shows what the server now holds.
// `state.workout` is null once the workout is deleted. Every request body is recorded.
function fakeServer() {
  const state: { workout: WorkoutDetail | null; bodies: unknown[] } = {
    workout: initialWorkout(),
    bodies: [],
  };
  // While set, every write waits for it before answering, like a slow network: the app sees the
  // request as in flight until the test calls the release function holdWrites() returned.
  let writesGate: Promise<void> | null = null;
  function holdWrites(): () => void {
    let release = () => {};
    writesGate = new Promise((resolve) => {
      release = resolve;
    });
    return () => {
      writesGate = null;
      release();
    };
  }
  // Wraps a route handler so it waits at the gate (if one is set) before running.
  function write(handler: MockRoutes[string]): MockRoutes[string] {
    return async (request) => {
      await writesGate;
      return handler(request);
    };
  }
  const notFound = () => jsonResponse(404, { error: 'Workout not found' });

  // Updates the stored workout and returns 200 with it, like the real routes.
  function save(change: (workout: WorkoutDetail) => WorkoutDetail) {
    if (!state.workout) return notFound();
    state.workout = change(state.workout);
    return jsonResponse(200, state.workout);
  }

  const routes: MockRoutes = {
    'GET /workouts': () => jsonResponse(200, state.workout ? [state.workout] : []),
    'GET /workouts/3': () => (state.workout ? jsonResponse(200, state.workout) : notFound()),
    'GET /exercises': () => jsonResponse(200, EXERCISES),
    'PATCH /workouts/3': write(({ body }) => {
      state.bodies.push(body);
      // `as` (a type assertion, not a check): the fake trusts the app's bodies, and the tests
      // check them exactly through state.bodies. The real server validates them.
      const { date, notes } = body as UpdateWorkoutBody;
      return save((w) => ({ ...w, date: date ?? w.date, notes: notes === undefined ? w.notes : notes }));
    }),
    'DELETE /workouts/3': write(() => {
      state.workout = null;
      return noContentResponse();
    }),
    'POST /workouts/3/sets': write(({ body }) => {
      state.bodies.push(body);
      const { exercise_id, reps, weight, unit } = body as AddSetBody;
      if (!state.workout) return notFound();
      save((w) => {
        const name = EXERCISES.find((e) => e.id === exercise_id)?.name ?? '?';
        const added: WorkoutDetailSet = {
          id: 99,
          exercise_id,
          exercise_name: name,
          set_number: Math.max(...w.sets.map((s) => s.set_number)) + 1,
          reps,
          weight,
          unit: unit ?? 'lb',
        };
        return { ...w, sets: [...w.sets, added] };
      });
      // The real route answers 201 Created.
      return jsonResponse(201, state.workout);
    }),
    'DELETE /workouts/3/exercises/1': write(() =>
      save((w) => ({ ...w, sets: w.sets.filter((s) => s.exercise_id !== 1) }))
    ),
  };
  // 99 is the id POST /workouts/3/sets gives a new set.
  for (const id of [31, 32, 33, 99]) {
    routes[`PATCH /workouts/3/sets/${id}`] = write(({ body }) => {
      state.bodies.push(body);
      const { reps, weight, unit } = body as { reps: number; weight: number; unit: 'lb' | 'kg' };
      return save((w) => ({
        ...w,
        sets: w.sets.map((s) => (s.id === id ? { ...s, reps, weight, unit } : s)),
      }));
    });
    routes[`DELETE /workouts/3/sets/${id}`] = write(() => {
      save((w) => ({ ...w, sets: w.sets.filter((s) => s.id !== id) }));
      return noContentResponse();
    });
  }

  const fetchMock = mockApi(routes);
  return { state, fetchMock, holdWrites };
}

// Alert.alert shows a native dialog, which doesn't exist in tests. This replaces it with one that
// "presses" the first of its buttons whose text is in `answers`, like a user picking that option.
// Returns the spy, to check which dialogs were shown.
function answerAlerts(...answers: string[]) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.text !== undefined && answers.includes(b.text))?.onPress?.();
  });
}

beforeEach(async () => {
  await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// Starts the app on the history, like a launch, then opens `url` the way a tap would.
// (Rendering straight at a deep link doesn't work: while the saved token is read, the signed-in
// screens are guarded off and the router redirects away, then lands on '/' once signed in. See
// ROADMAP.md.) See auth-screens.test.tsx for why the Promise is awaited separately.
// Href is expo-router's type for a valid app path (typed routes), so a typo is a compile error.
async function renderApp(url: Href) {
  const rendered = renderRouter('./src/app', { initialUrl: '/' });
  await rendered;
  await screen.findByRole('button', { name: 'Log out' });
  if (url !== '/') {
    await act(() => router.push(url));
  }
  return { getPathname: () => rendered.getPathname() };
}

// The card for one exercise (its testID in workouts/[id]/index.tsx).
function card(name: string) {
  return screen.getByTestId(`${name} card`);
}

it('shows the date, notes, and one card per exercise with sets numbered by position', async () => {
  fakeServer();
  await renderApp('/workouts/3');

  expect(await screen.findByText('Wed, Oct 14, 2026')).toBeOnTheScreen();
  expect(screen.getByText('Heavy day')).toBeOnTheScreen();
  expect(within(card('Squat')).getByText('Set 1 · 5 reps × 225 lb')).toBeOnTheScreen();
  expect(within(card('Squat')).getByText('Set 2 · 5 reps × 235 lb')).toBeOnTheScreen();
  expect(within(card('Bench Press')).getByText('Set 1 · 8 reps × 135 lb')).toBeOnTheScreen();
});

it('shows "Workout not found" for a workout the server does not have', async () => {
  mockApi({
    'GET /workouts': () => jsonResponse(200, []),
    'GET /workouts/404': () => jsonResponse(404, { error: 'Workout not found' }),
  });
  await renderApp('/workouts/404');

  expect(await screen.findByText('Workout not found')).toBeOnTheScreen();
});

it('shows "Workout not found" for an id that cannot exist, without asking the server', async () => {
  const fetchMock = mockApi({ 'GET /workouts': () => jsonResponse(200, []) });
  await renderApp('/workouts/abc');

  expect(await screen.findByText('Workout not found')).toBeOnTheScreen();
  expect(requestsMade(fetchMock)).toEqual(['GET /workouts']);
});

it('edits a set in a sheet and shows the saved values', async () => {
  const { state } = fakeServer();
  const app = await renderApp('/workouts/3');

  await fireEvent.press(await screen.findByRole('button', { name: 'Set 2 · 5 reps × 235 lb' }));
  await waitFor(() => expect(app.getPathname()).toBe('/workouts/3/sets/32'));
  // The sheet starts from the set's current values.
  expect(await screen.findByDisplayValue('235')).toBeOnTheScreen();
  await fireEvent.changeText(screen.getByLabelText('Reps'), '3');
  await fireEvent.changeText(screen.getByLabelText('Weight'), '107,5');
  await fireEvent.press(screen.getByRole('radio', { name: 'kg' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Set 2 · 3 reps × 107.5 kg')).toBeOnTheScreen();
  expect(app.getPathname()).toBe('/workouts/3');
  expect(state.bodies).toEqual([{ reps: 3, weight: 107.5, unit: 'kg' }]);
});

it('shows a form error and sends nothing for an invalid weight', async () => {
  const { fetchMock } = fakeServer();
  await renderApp('/workouts/3/sets/31');

  await fireEvent.changeText(await screen.findByLabelText('Weight'), '1.234');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText(/at most 2 decimals/)).toBeOnTheScreen();
  expect(requestsMade(fetchMock).filter((r) => r.startsWith('PATCH'))).toEqual([]);
});

it('deletes a set after confirming', async () => {
  const { fetchMock } = fakeServer();
  const alert = answerAlerts('Delete');
  const app = await renderApp('/workouts/3');

  await fireEvent.press(await screen.findByRole('button', { name: 'Set 1 · 5 reps × 225 lb' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete set' }));

  // The 235 set was Set 2; with the 225 set gone it's now Set 1.
  expect(await screen.findByText('Set 1 · 5 reps × 235 lb')).toBeOnTheScreen();
  expect(screen.queryByText(/225 lb/)).not.toBeOnTheScreen();
  expect(app.getPathname()).toBe('/workouts/3');
  // The 4th argument is the dialog's options (dismissable on Android).
  expect(alert).toHaveBeenCalledWith('Delete this set?', undefined, expect.any(Array), expect.anything());
  expect(requestsMade(fetchMock)).toContain('DELETE /workouts/3/sets/31');
});

it('keeps the set when the delete is cancelled', async () => {
  const { fetchMock } = fakeServer();
  answerAlerts('Cancel');
  await renderApp('/workouts/3/sets/31');

  await fireEvent.press(await screen.findByRole('button', { name: 'Delete set' }));

  expect(requestsMade(fetchMock).filter((r) => r.startsWith('DELETE'))).toEqual([]);
});

it("removes an exercise from its card's menu after confirming", async () => {
  const { fetchMock } = fakeServer();
  // First the menu ("Remove exercise"), then the confirmation ("Remove").
  answerAlerts('Remove exercise', 'Remove');
  await renderApp('/workouts/3');

  await fireEvent.press(await screen.findByRole('button', { name: 'Squat options' }));

  await waitFor(() => expect(screen.queryByTestId('Squat card')).not.toBeOnTheScreen());
  expect(card('Bench Press')).toBeOnTheScreen();
  expect(requestsMade(fetchMock)).toContain('DELETE /workouts/3/exercises/1');
});

it("adds a set to an exercise, copying the exercise's last set", async () => {
  const { state } = fakeServer();
  await renderApp('/workouts/3');

  await fireEvent.press(
    within(await screen.findByTestId('Squat card')).getByRole('button', { name: 'Add Squat set' })
  );

  expect(await within(card('Squat')).findByText('Set 3 · 5 reps × 235 lb')).toBeOnTheScreen();
  expect(state.bodies).toEqual([{ exercise_id: 1, reps: 5, weight: 235, unit: 'lb' }]);
});

it('edits the date and notes from the header', async () => {
  const { state } = fakeServer();
  const app = await renderApp('/workouts/3');

  await fireEvent.press(await screen.findByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(app.getPathname()).toBe('/workouts/3/edit'));
  await fireEvent.changeText(await screen.findByLabelText('Date'), '2026-10-13');
  await fireEvent.changeText(screen.getByLabelText('Notes'), '  ');
  await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Tue, Oct 13, 2026')).toBeOnTheScreen();
  expect(screen.queryByText('Heavy day')).not.toBeOnTheScreen();
  expect(state.bodies).toEqual([{ date: '2026-10-13', notes: null }]);
});

it('deletes the workout after confirming and goes back to an updated history', async () => {
  const { fetchMock } = fakeServer();
  answerAlerts('Delete');
  const app = await renderApp('/');

  await fireEvent.press(await screen.findByRole('button', { name: /Wed, Oct 14/ }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete workout' }));

  expect(await screen.findByText('No workouts yet')).toBeOnTheScreen();
  expect(app.getPathname()).toBe('/');
  expect(requestsMade(fetchMock)).toContain('DELETE /workouts/3');
});

// Each button that navigates or sends a request, tapped twice: one screen or one request, never two.
describe('double-tapping', () => {
  // How many times exactly this request ('POST /workouts/3/sets', ...) has been made.
  function count(fetchMock: jest.SpiedFunction<typeof fetch>, request: string) {
    return requestsMade(fetchMock).filter((r) => r === request).length;
  }

  it('a set opens its sheet once', async () => {
    fakeServer();
    const app = await renderApp('/workouts/3');

    await doubleTap(await screen.findByRole('button', { name: 'Set 2 · 5 reps × 235 lb' }));
    await waitFor(() => expect(app.getPathname()).toBe('/workouts/3/sets/32'));
    await act(() => router.back());

    expect(app.getPathname()).toBe('/workouts/3');
  });

  it('Edit opens its sheet once', async () => {
    fakeServer();
    const app = await renderApp('/workouts/3');

    await doubleTap(await screen.findByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(app.getPathname()).toBe('/workouts/3/edit'));
    await act(() => router.back());

    expect(app.getPathname()).toBe('/workouts/3');
  });

  it('Cancel in the set sheet closes only the sheet', async () => {
    fakeServer();
    const app = await renderApp('/workouts/3');
    await fireEvent.press(await screen.findByRole('button', { name: 'Set 2 · 5 reps × 235 lb' }));

    await doubleTap(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(app.getPathname()).toBe('/workouts/3'));
  });

  // The second tap lands while the first request is still on its way, as on a real network.
  it('+ Add set adds one set', async () => {
    const { fetchMock, holdWrites } = fakeServer();
    await renderApp('/workouts/3');
    const release = holdWrites();

    await doubleTap(await screen.findByRole('button', { name: 'Add Squat set' }));
    release();

    expect(await within(card('Squat')).findByText('Set 3 · 5 reps × 235 lb')).toBeOnTheScreen();
    expect(count(fetchMock, 'POST /workouts/3/sets')).toBe(1);
  });

  it('Save in the set sheet saves once and closes only the sheet', async () => {
    const { fetchMock, holdWrites } = fakeServer();
    const app = await renderApp('/workouts/3');
    await fireEvent.press(await screen.findByRole('button', { name: 'Set 2 · 5 reps × 235 lb' }));
    const release = holdWrites();

    await doubleTap(await screen.findByRole('button', { name: 'Save' }));
    release();

    await waitFor(() => expect(app.getPathname()).toBe('/workouts/3'));
    expect(count(fetchMock, 'PATCH /workouts/3/sets/32')).toBe(1);
  });

  it('Save in the edit sheet saves once and closes only the sheet', async () => {
    const { fetchMock, holdWrites } = fakeServer();
    const app = await renderApp('/workouts/3');
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit' }));
    const release = holdWrites();

    await doubleTap(await screen.findByRole('button', { name: 'Save' }));
    release();

    await waitFor(() => expect(app.getPathname()).toBe('/workouts/3'));
    expect(count(fetchMock, 'PATCH /workouts/3')).toBe(1);
  });

  // The second tap lands before the first one's dialog has been answered.
  it('Delete set asks once and deletes once', async () => {
    const { fetchMock } = fakeServer();
    const dialogs = recordAlerts();
    const app = await renderApp('/workouts/3');
    await fireEvent.press(await screen.findByRole('button', { name: 'Set 2 · 5 reps × 235 lb' }));

    await doubleTap(await screen.findByRole('button', { name: 'Delete set' }));
    expect(dialogs.spy).toHaveBeenCalledTimes(1);
    await dialogs.answer('Delete');

    await waitFor(() => expect(app.getPathname()).toBe('/workouts/3'));
    expect(count(fetchMock, 'DELETE /workouts/3/sets/32')).toBe(1);
  });

  it('the exercise menu opens once and removes the exercise once', async () => {
    const { fetchMock } = fakeServer();
    const dialogs = recordAlerts();
    await renderApp('/workouts/3');

    await doubleTap(await screen.findByRole('button', { name: 'Squat options' }));
    expect(dialogs.spy).toHaveBeenCalledTimes(1);
    await dialogs.answer('Remove exercise');
    await dialogs.answer('Remove');

    await waitFor(() => expect(screen.queryByTestId('Squat card')).not.toBeOnTheScreen());
    expect(count(fetchMock, 'DELETE /workouts/3/exercises/1')).toBe(1);
  });

  it('Delete workout asks once, deletes once, and lands on the history', async () => {
    const { fetchMock } = fakeServer();
    const dialogs = recordAlerts();
    const app = await renderApp('/');
    await fireEvent.press(await screen.findByRole('button', { name: /Wed, Oct 14/ }));

    await doubleTap(await screen.findByRole('button', { name: 'Delete workout' }));
    expect(dialogs.spy).toHaveBeenCalledTimes(1);
    await dialogs.answer('Delete');

    expect(await screen.findByText('No workouts yet')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
    expect(count(fetchMock, 'DELETE /workouts/3')).toBe(1);
  });
});

describe('+ Add exercise', () => {
  // The picker is a Modal. On iOS (Jest's platform) the screen waits for the Modal's onDismiss,
  // which native code calls once the slide-away animation has finished, before it opens the next
  // sheet: iOS can't present a screen while another is still being dismissed. Jest has no native
  // side, and its Modal mock renders nothing once hidden, so this grabs the open picker first and
  // then, after `close` has hidden it, calls its onDismiss itself, as native code would.
  async function closePicker(close: () => Promise<void>) {
    const picker = screen.getByTestId('exercise-picker');
    await close();
    // `unknown`, then narrowed: element props aren't typed, and calling an unchecked value
    // would be an `any` in disguise.
    const onDismiss: unknown = picker.props.onDismiss;
    if (typeof onDismiss !== 'function') {
      throw new Error('The picker has no onDismiss');
    }
    await act(async () => onDismiss());
  }

  it("offers only exercises not in the workout, adds the first set, and opens it to fill in", async () => {
    const { state } = fakeServer();
    const app = await renderApp('/workouts/3');

    await fireEvent.press(await screen.findByRole('button', { name: 'Add exercise' }));
    const deadlift = await screen.findByRole('button', { name: 'Deadlift' });
    expect(screen.queryByRole('button', { name: 'Squat' })).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Bench Press' })).not.toBeOnTheScreen();
    await closePicker(() => fireEvent.press(deadlift));

    // The first set is saved straight away, then its sheet opens for the real numbers.
    await waitFor(() => expect(app.getPathname()).toBe('/workouts/3/sets/99'));
    expect(state.bodies).toEqual([{ exercise_id: 3, reps: 0, weight: 0, unit: 'lb' }]);
    expect(await screen.findByText('Deadlift · Set 1')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Reps'), '5');
    await fireEvent.changeText(screen.getByLabelText('Weight'), '315');
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(app.getPathname()).toBe('/workouts/3'));
    expect(within(await screen.findByTestId('Deadlift card')).getByText('Set 1 · 5 reps × 315 lb')).toBeOnTheScreen();
  });

  it('adds nothing when the picker is cancelled', async () => {
    const { state } = fakeServer();
    const app = await renderApp('/workouts/3');

    await fireEvent.press(await screen.findByRole('button', { name: 'Add exercise' }));
    const cancel = await screen.findByRole('button', { name: 'Cancel' });
    await closePicker(() => fireEvent.press(cancel));

    expect(state.bodies).toEqual([]);
    expect(app.getPathname()).toBe('/workouts/3');
  });
});
