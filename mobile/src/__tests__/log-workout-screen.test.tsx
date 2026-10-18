// Integration tests for the "Log workout" screen: the real app from src/app/, signed in, with a
// fake backend.
import type {
  CreateExerciseBody,
  CreateWorkoutBody,
  Exercise,
  ExerciseLastSets,
  WorkoutDetail,
} from '@shared/models';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { TOKEN_KEY } from '@/auth/token-storage';
import { recordAlerts } from '@/test-utils/alerts';
import { doubleTap } from '@/test-utils/double-tap';
import { jsonResponse, mockApi, requestsMade } from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');
// DateField's native picker is replaced by plain Views in jest.setup.tsx, so a test can fire its
// onDateChange.

// 05:30 UTC on Wednesday 14 October is 22:30 on Tuesday the 13th in Los Angeles, the zone Jest
// runs in (jest.global-setup.js). The phone's "today" is the 13th; UTC's would be the 14th.
const NOW = new Date('2026-10-14T05:30:00Z');

const EXERCISES: Exercise[] = [
  { id: 1, name: 'Bench Press', muscle_group: 'Chest', created_by: null },
  { id: 2, name: 'Squat', muscle_group: 'Legs', created_by: null },
  { id: 3, name: 'Deadlift', muscle_group: 'Back', created_by: null },
];

// A backend that saves one new workout (id 7) and then serves it in the history and as detail.
// `holdSave()` keeps both POSTs (workouts and exercises) unanswered until the returned function
// is called.
// `exercises` is the server's list: POST /exercises adds to it (ids from 100), with the real
// route's 409 for a name already in it, ignoring case. A test can also push to it directly, as if
// the exercise was created on another phone after the app loaded its list.
// `lastSets`: last time's sets per exercise id, for GET /exercises/last-sets (none by default:
// every exercise is never logged). `holdLastSets()` keeps that request unanswered until the
// returned function is called.
function fakeServer(lastSets: Record<number, ExerciseLastSets['sets']> = {}) {
  const saved: CreateWorkoutBody[] = [];
  const exercises: Exercise[] = [...EXERCISES];
  const createdExercises: CreateExerciseBody[] = [];
  let gate: Promise<void> | null = null;
  let lastSetsGate: Promise<void> | null = null;

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
        exercise_name: exercises.find((e) => e.id === s.exercise_id)?.name ?? '?',
        // Like the real server: each exercise's sets are 1, 2, 3... in the order they were sent,
        // i.e. how many sets of this exercise there are up to and including this one.
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
    // The chooser behind "+ Log workout" lists them.
    'GET /templates': () => jsonResponse(200, []),
    'GET /exercises': () => jsonResponse(200, exercises),
    // Like the real route: in the order asked, leaving out exercises never logged.
    'GET /exercises/last-sets': async ({ query }) => {
      await lastSetsGate;
      const ids = (query.get('ids') ?? '').split(',').map(Number);
      const found: ExerciseLastSets[] = ids.flatMap((id) => {
        const sets = lastSets[id];
        return sets ? [{ exercise_id: id, date: '2026-10-09', sets }] : [];
      });
      return jsonResponse(200, found);
    },
    'POST /exercises': async ({ body }) => {
      await gate;
      // `as`: trusted like the POST /workouts body below.
      const created = body as CreateExerciseBody;
      createdExercises.push(created);
      const name = created.name.trim();
      if (exercises.some((e) => e.name.toLowerCase() === name.toLowerCase())) {
        return jsonResponse(409, { error: `An exercise named "${name}" already exists` });
      }
      const exercise: Exercise = {
        id: 100 + exercises.length,
        name,
        muscle_group: created.muscle_group?.trim() || null,
        created_by: 1,
      };
      exercises.push(exercise);
      return jsonResponse(201, exercise);
    },
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

  function holdLastSets(): () => void {
    let release = () => {};
    lastSetsGate = new Promise((resolve) => {
      release = resolve;
    });
    return () => {
      lastSetsGate = null;
      release();
    };
  }

  return { saved, exercises, createdExercises, fetchMock, holdSave, holdLastSets };
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

// Starts on the history and opens an empty log screen with its header button and the chooser
// sheet, like a user. (Starting from a template: start-from-template.test.tsx.)
// See auth-screens.test.tsx for why the Promise is awaited separately.
async function openLogScreen() {
  const rendered = renderRouter('./src/app', { initialUrl: '/' });
  await rendered;
  await fireEvent.press(await screen.findByRole('button', { name: 'Log workout' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Empty workout' }));
  await waitFor(() => expect(rendered.getPathname()).toBe('/workouts/new'));
  return { getPathname: () => rendered.getPathname() };
}

// Opens the picker, searches, and picks `name`, then waits for its rows (they appear once last
// time's sets have been fetched).
async function addExercise(name: string, search = '') {
  await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
  if (search) {
    await fireEvent.changeText(await screen.findByLabelText('Search exercises'), search);
  }
  await fireEvent.press(await screen.findByRole('button', { name }));
  await screen.findByLabelText(`${name} set 1 reps`);
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
        { exercise_id: 2, reps: 5, weight: 225, unit: 'lb' },
        { exercise_id: 2, reps: 3, weight: 225, unit: 'lb' },
        { exercise_id: 1, reps: 8, weight: 60.5, unit: 'kg' },
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
  expect(saved[0]?.sets).toEqual([{ exercise_id: 2, reps: 5, weight: 225, unit: 'lb' }]);
});

it('shows validation errors next to the fields and saves nothing while any set is invalid', async () => {
  const { fetchMock } = fakeServer();
  await openLogScreen();
  await addExercise('Squat');
  const save = screen.getByRole('button', { name: 'Save workout' });

  // An invalid value shows its error as soon as it's typed (typing ticked the set).
  await fillSet('Squat', 1, '5', '1.234');
  expect(screen.getByText(/at most 2 decimals/)).toBeOnTheScreen();

  await fireEvent.changeText(screen.getByLabelText('Squat set 1 weight'), '100');
  expect(screen.queryByText(/at most 2 decimals/)).not.toBeOnTheScreen();

  // An empty field only shows its error once Save is pressed.
  await fireEvent.press(screen.getByRole('button', { name: 'Add Squat set' }));
  await fireEvent.changeText(screen.getByLabelText('Squat set 2 reps'), '');
  expect(screen.queryByText('Reps must be a whole number.')).not.toBeOnTheScreen();
  await fireEvent.press(save);

  expect(await screen.findByText('Reps must be a whole number.')).toBeOnTheScreen();
  expect(requestsMade(fetchMock)).not.toContain('POST /workouts');
});

it('explains instead of saving when no set is ticked, and skips untouched sets', async () => {
  const { saved, fetchMock } = fakeServer();
  await openLogScreen();
  await addExercise('Squat');
  const save = screen.getByRole('button', { name: 'Save workout' });

  // Save stays enabled and says why it can't save.
  await fireEvent.press(save);
  expect(await screen.findByText(/Tick ✓ on at least one set/)).toBeOnTheScreen();
  expect(requestsMade(fetchMock)).not.toContain('POST /workouts');

  // Typing ticks the set; a second, untouched exercise isn't saved and shows no error.
  await fillSet('Squat', 1, '5', '225');
  expect(screen.getByRole('checkbox', { name: 'Squat set 1 done' })).toBeChecked();
  expect(screen.queryByText(/Tick ✓ on at least one set/)).not.toBeOnTheScreen();
  await addExercise('Deadlift');
  await fireEvent.press(save);

  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]?.sets).toEqual([{ exercise_id: 2, reps: 5, weight: 225, unit: 'lb' }]);
});

describe("last time's sets as hints", () => {
  it('loads them on the new card, then shows one hinted row per set, and saves ticked ones', async () => {
    const { saved, holdLastSets } = fakeServer({
      2: [
        { reps: 5, weight: 225, unit: 'lb' },
        { reps: 5, weight: 235, unit: 'lb' },
        { reps: 3, weight: 245, unit: 'lb' },
      ],
    });
    await openLogScreen();
    const release = holdLastSets();

    await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Squat' }));

    // The card is there with a spinner and no rows, so nothing changes once typing starts.
    const card = await screen.findByTestId('Squat card');
    expect(within(card).getByLabelText('Loading last time for Squat')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Squat set 1 reps')).not.toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: 'Add Squat set' })).not.toBeOnTheScreen();
    release();

    expect(await screen.findByLabelText('Squat set 1 reps')).toHaveProp('placeholder', '5');
    expect(screen.getByLabelText('Squat set 2 weight')).toHaveProp('placeholder', '235');
    expect(screen.getByLabelText('Squat set 3 reps')).toHaveProp('placeholder', '3');
    expect(screen.queryByLabelText('Squat set 4 reps')).not.toBeOnTheScreen();
    expect(screen.queryByLabelText('Loading last time for Squat')).not.toBeOnTheScreen();
    expect(screen.getByRole('checkbox', { name: 'Squat set 1 done' })).not.toBeChecked();

    // ✓ keeps last time's numbers; typing replaces the hint for that field only.
    await fireEvent.press(screen.getByRole('checkbox', { name: 'Squat set 1 done' }));
    await fireEvent.changeText(screen.getByLabelText('Squat set 3 reps'), '4');
    await fireEvent.press(screen.getByRole('button', { name: 'Save workout' }));

    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.sets).toEqual([
      { exercise_id: 2, reps: 5, weight: 225, unit: 'lb' },
      { exercise_id: 2, reps: 4, weight: 245, unit: 'lb' },
    ]);
  });

  it('gives a never-logged exercise one empty row, in the unit used last', async () => {
    const { fetchMock } = fakeServer({ 2: [{ reps: 8, weight: 100, unit: 'kg' }] });
    await openLogScreen();
    await addExercise('Squat');

    await addExercise('Deadlift');

    expect(screen.getByLabelText('Deadlift set 1 reps')).toHaveProp('placeholder', 'Reps');
    expect(screen.queryByLabelText('Deadlift set 2 reps')).not.toBeOnTheScreen();
    expect(
      within(screen.getByLabelText('Deadlift set 1 unit')).getByRole('radio', { name: 'kg' })
    ).toBeChecked();
    expect(requestsMade(fetchMock)).toContain('GET /exercises/last-sets?ids=3');
  });

  it('gives a custom exercise just created one empty row', async () => {
    fakeServer({ 2: [{ reps: 8, weight: 100, unit: 'lb' }] });
    await openLogScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
    await screen.findByRole('button', { name: 'Squat' });
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'Cable Fly');
    await fireEvent.press(screen.getByRole('button', { name: 'Create "Cable Fly"' }));

    await fireEvent.press(await screen.findByRole('button', { name: 'Create' }));

    expect(await screen.findByLabelText('Cable Fly set 1 reps')).toHaveProp('placeholder', 'Reps');
    expect(screen.queryByLabelText('Cable Fly set 2 reps')).not.toBeOnTheScreen();
  });
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

it('saves the day picked in the date picker', async () => {
  const { saved } = fakeServer();
  await openLogScreen();

  // The picker hands back a Date, an instant in time. 20:00 on the 11th in Los Angeles is already
  // 03:00 on the 12th in UTC, so this checks the day is read in the phone's time zone.
  await fireEvent(screen.getByTestId('date-picker'), 'dateChange', new Date(2026, 9, 11, 20, 0));
  await addExercise('Squat');
  await fillSet('Squat', 1, '5', '225');
  await fireEvent.press(screen.getByRole('button', { name: 'Save workout' }));

  await waitFor(() => expect(saved).toHaveLength(1));
  expect(saved[0]?.date).toBe('2026-10-11');
});

describe('creating an exercise from the picker', () => {
  // Opens the picker and types into its search box once the list has loaded.
  async function search(text: string) {
    await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
    await screen.findByRole('button', { name: 'Squat' });
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), text);
  }

  // Searches, then opens the new-exercise form from the Create row.
  async function openCreateForm(text: string, name = text.trim()) {
    await search(text);
    await fireEvent.press(screen.getByRole('button', { name: `Create "${name}"` }));
    await screen.findByRole('header', { name: 'New exercise' });
  }

  it('offers Create "<search>" at the top of the list, above partial matches', async () => {
    fakeServer();
    await openLogScreen();

    await search('squ');

    const labels = screen.getAllByRole('button').map((b) => b.props.accessibilityLabel);
    expect(labels.indexOf('Create "squ"')).toBeGreaterThan(-1);
    expect(labels.indexOf('Create "squ"')).toBeLessThan(labels.indexOf('Squat'));
  });

  it('offers no Create for the exact name of an exercise, ignoring case', async () => {
    fakeServer();
    await openLogScreen();

    await search('bench PRESS ');

    expect(screen.getByRole('button', { name: 'Bench Press' })).toBeOnTheScreen();
    expect(screen.queryByRole('button', { name: /^Create/ })).not.toBeOnTheScreen();
  });

  it('opens a form with the name filled in and the existing muscle groups to choose from', async () => {
    const { createdExercises } = fakeServer();
    await openLogScreen();

    await openCreateForm(' Cable Fly ');

    expect(screen.getByLabelText('Name')).toHaveDisplayValue('Cable Fly');
    expect(screen.getByLabelText('Muscle group')).toHaveDisplayValue('');
    const choices = within(screen.getByLabelText('Muscle group choices'));
    expect(choices.getAllByRole('radio').map((r) => r.props.accessibilityLabel)).toEqual([
      'Back',
      'Chest',
      'Legs',
    ]);
    // Nothing is created until the form's Create is pressed.
    expect(createdExercises).toEqual([]);
  });

  it('creates the exercise with a chosen muscle group and adds it to the workout', async () => {
    const { saved, createdExercises } = fakeServer();
    await openLogScreen();
    await openCreateForm('Cable Fly');

    await fireEvent.press(screen.getByRole('radio', { name: 'Chest' }));
    expect(screen.getByLabelText('Muscle group')).toHaveDisplayValue('Chest');
    expect(screen.getByRole('radio', { name: 'Chest' })).toBeChecked();
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));

    // Picked straight away: the picker closes and the card is there to fill in.
    await screen.findByTestId('Cable Fly card');
    expect(screen.queryByLabelText('Search exercises')).not.toBeOnTheScreen();
    expect(createdExercises).toEqual([{ name: 'Cable Fly', muscle_group: 'Chest' }]);

    await fillSet('Cable Fly', 1, '12', '30');
    await fireEvent.press(screen.getByRole('button', { name: 'Save workout' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(saved[0]?.sets).toEqual([
      { exercise_id: 103, reps: 12, weight: 30, unit: 'lb' },
    ]);
  });

  it('takes an edited name and a new muscle group typed in, both trimmed', async () => {
    const { createdExercises } = fakeServer();
    await openLogScreen();
    await openCreateForm('wrist');

    await fireEvent.changeText(screen.getByLabelText('Name'), ' Wrist Curl ');
    await fireEvent.changeText(screen.getByLabelText('Muscle group'), ' Forearms ');
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));

    await screen.findByTestId('Wrist Curl card');
    expect(createdExercises).toEqual([{ name: 'Wrist Curl', muscle_group: 'Forearms' }]);
  });

  it('sends no muscle group when none is given, and a second tap on a choice clears it', async () => {
    const { createdExercises } = fakeServer();
    await openLogScreen();
    await openCreateForm('Cable Fly');

    await fireEvent.press(screen.getByRole('radio', { name: 'Chest' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Chest' }));
    expect(screen.getByLabelText('Muscle group')).toHaveDisplayValue('');
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));

    await screen.findByTestId('Cable Fly card');
    expect(createdExercises).toEqual([{ name: 'Cable Fly', muscle_group: null }]);
  });

  it('disables Create while the name is blank', async () => {
    fakeServer();
    await openLogScreen();
    await openCreateForm('Cable Fly');

    await fireEvent.changeText(screen.getByLabelText('Name'), '   ');

    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });

  it('goes back to the list with the search kept, creating nothing', async () => {
    const { createdExercises } = fakeServer();
    await openLogScreen();
    await openCreateForm('squ');

    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText('Search exercises')).toHaveDisplayValue('squ');
    expect(screen.getByRole('button', { name: 'Squat' })).toBeOnTheScreen();
    expect(createdExercises).toEqual([]);
  });

  it("shows the server's error for a duplicate name, and the existing exercise back in the list", async () => {
    const { exercises } = fakeServer();
    await openLogScreen();
    await search('');
    // Created elsewhere after the app loaded its list, so the app still offers Create.
    exercises.push({ id: 50, name: 'Cable Fly', muscle_group: 'Chest', created_by: 1 });
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'cable fly');
    await fireEvent.press(screen.getByRole('button', { name: 'Create "cable fly"' }));

    await fireEvent.press(await screen.findByRole('button', { name: 'Create' }));

    // The form stays open with the server's message.
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'An exercise named "cable fly" already exists'
    );
    expect(screen.getByLabelText('Name')).toHaveDisplayValue('cable fly');
    // The 409 refreshed the list, so back in it the real one is there to pick.
    await fireEvent.press(screen.getByRole('button', { name: 'Back' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Cable Fly' }));
    await screen.findByTestId('Cable Fly card');
  });

  it('clears the error once the name or muscle group changes', async () => {
    const { exercises } = fakeServer();
    await openLogScreen();
    await search('');
    exercises.push({ id: 50, name: 'Cable Fly', muscle_group: null, created_by: 1 });
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'Cable Fly');
    await fireEvent.press(screen.getByRole('button', { name: 'Create "Cable Fly"' }));
    const create = await screen.findByRole('button', { name: 'Create' });

    await fireEvent.press(create);
    await screen.findByRole('alert');
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Cable Flye');
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();

    // Back to the duplicate, to get the error again.
    await fireEvent.changeText(screen.getByLabelText('Name'), 'Cable Fly');
    await fireEvent.press(create);
    await screen.findByRole('alert');
    await fireEvent.changeText(screen.getByLabelText('Muscle group'), 'Chest');
    expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  });

  it('lists the new exercise with its muscle group the next time the picker opens', async () => {
    const { fetchMock } = fakeServer();
    await openLogScreen();
    await openCreateForm('Wrist Curl');
    await fireEvent.changeText(screen.getByLabelText('Muscle group'), 'Forearms');
    await fireEvent.press(screen.getByRole('button', { name: 'Create' }));
    await screen.findByTestId('Wrist Curl card');
    // Removed from this workout, so the picker offers it again.
    await fireEvent.press(screen.getByRole('button', { name: 'Remove Wrist Curl' }));

    await search('wrist');

    const item = await screen.findByRole('button', { name: 'Wrist Curl' });
    expect(within(item).getByText('Forearms')).toBeOnTheScreen();
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'Wrist Curl');
    expect(screen.queryByRole('button', { name: /^Create/ })).not.toBeOnTheScreen();
    expect(requestsMade(fetchMock).filter((r) => r === 'POST /exercises')).toHaveLength(1);
    // Its new muscle group is now one of the choices for the next exercise.
    await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'Hammer Curl');
    await fireEvent.press(screen.getByRole('button', { name: 'Create "Hammer Curl"' }));
    expect(await screen.findByRole('radio', { name: 'Forearms' })).toBeOnTheScreen();
  });

  it('creates the exercise once on a double tap', async () => {
    const { createdExercises, holdSave } = fakeServer();
    await openLogScreen();
    await openCreateForm('Cable Fly');

    // Held, so the form is still open for the second tap, as on a slow network.
    const release = holdSave();
    await doubleTap(screen.getByRole('button', { name: 'Create' }));
    release();

    await screen.findByTestId('Cable Fly card');
    expect(createdExercises).toHaveLength(1);
  });
});
