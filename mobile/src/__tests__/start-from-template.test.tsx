// Starting a workout from a template, via a template's Start workout or the Log workout chooser,
// in the real app with a fake backend.
import type {
  CreateWorkoutBody,
  Exercise,
  ExerciseLastSets,
  TemplateDetail,
  WorkoutDetail,
} from '@shared/models';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { TOKEN_KEY } from '@/auth/token-storage';
import { recordAlerts } from '@/test-utils/alerts';
import { jsonResponse, mockApi, requestsMade } from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');

// 22:30 on Tuesday 13 October in Los Angeles, where Jest runs (see log-workout-screen.test.tsx).
const NOW = new Date('2026-10-14T05:30:00Z');
const TODAY = '2026-10-13';

const EXERCISES: Exercise[] = [
  { id: 1, name: 'Squat', muscle_group: 'Legs', created_by: null },
  { id: 2, name: 'RDL', muscle_group: 'Legs', created_by: null },
  { id: 3, name: 'Leg press', muscle_group: 'Legs', created_by: null },
];

const LEG_DAY: TemplateDetail = {
  id: 1,
  name: 'Leg day',
  exercises: [
    { exercise_id: 1, exercise_name: 'Squat', set_count: 3 },
    { exercise_id: 2, exercise_name: 'RDL', set_count: 2 },
    { exercise_id: 3, exercise_name: 'Leg press', set_count: 2 },
  ],
};

// Last time: Squat had two sets (so its third row repeats the second), RDL three (so only the
// first two are used), and Leg press was never logged, so the server leaves it out.
const LAST_SETS: ExerciseLastSets[] = [
  {
    exercise_id: 1,
    date: '2026-10-09',
    sets: [
      { reps: 5, weight: 225, unit: 'lb' },
      { reps: 3, weight: 245, unit: 'lb' },
    ],
  },
  {
    exercise_id: 2,
    date: '2026-10-09',
    sets: [
      { reps: 8, weight: 135, unit: 'lb' },
      { reps: 7, weight: 145, unit: 'lb' },
      { reps: 6, weight: 155, unit: 'lb' },
    ],
  },
];

// One template, and a history that gets the saved workout (id 7). holdLastSets() delays last
// time's sets until called, to see the screen before the hints arrive.
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
        set_number: body.sets.slice(0, i + 1).filter((t) => t.exercise_id === s.exercise_id).length,
        reps: s.reps,
        weight: s.weight,
        unit: s.unit ?? 'lb',
      })),
    };
  }

  const fetchMock = mockApi({
    'GET /workouts': () => {
      const w = workout();
      return jsonResponse(200, w ? [w] : []);
    },
    'GET /workouts/7': () => jsonResponse(200, workout()),
    'GET /templates': () => jsonResponse(200, [LEG_DAY]),
    'GET /templates/1': () => jsonResponse(200, LEG_DAY),
    'GET /exercises': () => jsonResponse(200, EXERCISES),
    'GET /exercises/last-sets?ids=1,2,3': async () => {
      await gate;
      return jsonResponse(200, LAST_SETS);
    },
    'POST /workouts': ({ body }) => {
      // `as`: the fake trusts the app's body; the tests check it exactly through `saved`.
      saved.push(body as CreateWorkoutBody);
      return jsonResponse(201, { id: 7 });
    },
  });

  function holdLastSets(): () => void {
    let release = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });
    return () => {
      gate = null;
      release();
    };
  }

  return { saved, fetchMock, holdLastSets };
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

async function renderApp() {
  const rendered = renderRouter('./src/app', { initialUrl: '/' });
  await rendered;
  await screen.findByRole('button', { name: 'Log out' });
  return { getPathname: () => rendered.getPathname() };
}

// Opens Leg day from the Templates tab and taps Start workout.
async function startFromTemplateScreen(app: { getPathname: () => string }) {
  await fireEvent.press(screen.getByRole('button', { name: /^Templates, tab, \d+ of \d+$/ }));
  await fireEvent.press(await screen.findByRole('button', { name: /^Leg day · / }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Start workout' }));
  await waitFor(() => expect(app.getPathname()).toBe('/workouts/new'));
}

function reps(name: string, n: number) {
  return screen.getByLabelText(`${name} set ${n} reps`);
}

function weight(name: string, n: number) {
  return screen.getByLabelText(`${name} set ${n} weight`);
}

function check(name: string, n: number) {
  return screen.getByRole('checkbox', { name: `${name} set ${n} done` });
}

it('starts a workout from a template, saving only the ticked sets, hints filling blanks', async () => {
  const { saved, holdLastSets } = fakeServer();
  const app = await renderApp();
  const release = holdLastSets();

  await startFromTemplateScreen(app);

  // Until last time's sets arrive: a loading state, no rows whose hints could change.
  expect(screen.getByLabelText('Loading workout')).toBeOnTheScreen();
  expect(screen.queryByLabelText('Squat set 1 reps')).not.toBeOnTheScreen();
  release();

  // Rows per the template, hinted from last time (row i from set i, extras repeat the last set,
  // RDL only uses its first two), nothing typed and nothing ticked.
  expect(await screen.findByLabelText('Squat set 1 reps')).toHaveProp('placeholder', '5');
  expect(weight('Squat', 1)).toHaveProp('placeholder', '225');
  expect(reps('Squat', 3)).toHaveProp('placeholder', '3');
  expect(weight('Squat', 3)).toHaveProp('placeholder', '245');
  expect(reps('RDL', 2)).toHaveProp('placeholder', '7');
  expect(screen.queryByLabelText('RDL set 3 reps')).not.toBeOnTheScreen();
  // Never logged: plain placeholders.
  expect(reps('Leg press', 1)).toHaveProp('placeholder', 'Reps');
  expect(reps('Squat', 1)).toHaveDisplayValue('');
  expect(check('Squat', 1)).not.toBeChecked();

  // Ticking an untouched row saves it with last time's numbers.
  await fireEvent.press(check('Squat', 1));
  expect(check('Squat', 1)).toBeChecked();
  // Typing ticks the row; the weight left blank comes from the hint.
  await fireEvent.changeText(reps('Squat', 2), '4');
  expect(check('Squat', 2)).toBeChecked();
  // Ticked, then unticked: dropped.
  await fireEvent.press(check('Squat', 3));
  await fireEvent.press(check('Squat', 3));
  await fireEvent.press(check('RDL', 2));
  await fireEvent.changeText(reps('Leg press', 1), '10');
  await fireEvent.changeText(weight('Leg press', 1), '200');

  await fireEvent.press(screen.getByRole('button', { name: 'Save workout' }));

  await waitFor(() => expect(app.getPathname()).toBe('/workouts/7'));
  expect(saved).toEqual([
    {
      date: TODAY,
      sets: [
        { exercise_id: 1, reps: 5, weight: 225, unit: 'lb' },
        { exercise_id: 1, reps: 4, weight: 245, unit: 'lb' },
        { exercise_id: 2, reps: 7, weight: 145, unit: 'lb' },
        { exercise_id: 3, reps: 10, weight: 200, unit: 'lb' },
      ],
    },
  ]);
});

it('explains instead of saving when no set is ticked', async () => {
  const { fetchMock } = fakeServer();
  const app = await renderApp();
  await startFromTemplateScreen(app);
  await screen.findByLabelText('Squat set 1 reps');

  await fireEvent.press(screen.getByRole('button', { name: 'Save workout' }));

  expect(await screen.findByText(/Tick ✓ on at least one set/)).toBeOnTheScreen();
  expect(requestsMade(fetchMock)).not.toContain('POST /workouts');
  expect(app.getPathname()).toBe('/workouts/new');
});

it('leaves an untouched template workout without asking to discard it', async () => {
  fakeServer();
  const dialogs = recordAlerts();
  const app = await renderApp();
  await startFromTemplateScreen(app);
  await screen.findByLabelText('Squat set 1 reps');

  await act(() => router.back());

  expect(app.getPathname()).toBe('/templates/1');
  expect(dialogs.spy).not.toHaveBeenCalled();
});

it('asks to discard once a set is ticked', async () => {
  fakeServer();
  const dialogs = recordAlerts();
  const app = await renderApp();
  await startFromTemplateScreen(app);
  await fireEvent.press(await screen.findByRole('checkbox', { name: 'Squat set 1 done' }));

  await act(() => router.back());

  expect(dialogs.spy).toHaveBeenCalledWith(
    'Discard this workout?',
    expect.any(String),
    expect.any(Array),
    expect.anything()
  );
  expect(app.getPathname()).toBe('/workouts/new');
});

describe('"+ Log workout" on the history', () => {
  it('offers an empty workout or a template, and starts from the template picked', async () => {
    fakeServer();
    const app = await renderApp();

    await fireEvent.press(screen.getByRole('button', { name: 'Log workout' }));

    await waitFor(() => expect(app.getPathname()).toBe('/workouts/start'));
    expect(screen.getByRole('button', { name: 'Empty workout' })).toBeOnTheScreen();
    await fireEvent.press(await screen.findByRole('button', { name: /^Leg day · Squat 3 · RDL 2 · / }));

    await waitFor(() => expect(app.getPathname()).toBe('/workouts/new'));
    expect(await screen.findByLabelText('Squat set 1 reps')).toHaveProp('placeholder', '5');
    // The chooser was replaced, so back goes to the history.
    await act(() => router.back());
    expect(app.getPathname()).toBe('/');
  });

  it('starts an empty workout', async () => {
    fakeServer();
    const app = await renderApp();

    await fireEvent.press(screen.getByRole('button', { name: 'Log workout' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Empty workout' }));

    await waitFor(() => expect(app.getPathname()).toBe('/workouts/new'));
    expect(await screen.findByText('Add an exercise to start.')).toBeOnTheScreen();
  });
});
