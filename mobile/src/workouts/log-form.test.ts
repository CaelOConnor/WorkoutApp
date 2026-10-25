import type { ExerciseLastSets, TemplateDetail } from '@shared/models';

import {
  createLogForm,
  createLogFormFromTemplate,
  hasChanges,
  logFormReducer,
  NO_SETS_ERROR,
  validateLogForm,
  type LogAction,
  type LogForm,
  type LogSet,
} from './log-form';

const TODAY = '2026-10-13';
const SQUAT = { id: 2, name: 'Squat' };
const BENCH = { id: 1, name: 'Bench Press' };

// Applies actions in order, like the screen dispatching them one by one.
function apply(form: LogForm, ...actions: LogAction[]): LogForm {
  return actions.reduce(logFormReducer, form);
}

// The keys the form gave the nth exercise and its sets, for actions that target them.
function exerciseKey(form: LogForm, index: number): number {
  const exercise = form.exercises[index];
  if (!exercise) throw new Error(`No exercise ${index}`);
  return exercise.key;
}

function setKeys(form: LogForm, index: number): number[] {
  return form.exercises[index]?.sets.map((s) => s.key) ?? [];
}

// A form with Squat (one set, filled in) ready for each test.
function withSquat(reps = '5', weight = '225'): LogForm {
  const form = apply(createLogForm(TODAY), { type: 'addExercise', exercise: SQUAT });
  const key = exerciseKey(form, 0);
  const [setKey = -1] = setKeys(form, 0);
  return apply(form, { type: 'updateSet', exerciseKey: key, setKey, change: { reps, weight } });
}

// `exercise` and `set` are positions in the form, here and in the helpers below.
function setAt(form: LogForm, exercise: number, set: number): LogSet {
  const found = form.exercises[exercise]?.sets[set];
  if (!found) throw new Error(`No set ${exercise}/${set}`);
  return found;
}

// Like tapping the set's checkmark on screen.
function tick(form: LogForm, exercise: number, set: number): LogForm {
  return apply(form, {
    type: 'toggleSet',
    exerciseKey: exerciseKey(form, exercise),
    setKey: setAt(form, exercise, set).key,
  });
}

function typeInto(
  form: LogForm,
  exercise: number,
  set: number,
  change: { reps?: string; weight?: string }
): LogForm {
  return apply(form, {
    type: 'updateSet',
    exerciseKey: exerciseKey(form, exercise),
    setKey: setAt(form, exercise, set).key,
    change,
  });
}

// What each row of an exercise holds: [typed reps, typed weight, unit, hint, ticked].
function rowsOf(form: LogForm, exercise: number) {
  return form.exercises[exercise]?.sets.map((s) => [s.reps, s.weight, s.unit, s.hint, s.ticked]);
}

const LEG_DAY: TemplateDetail = {
  id: 4,
  name: 'Leg day',
  exercises: [
    { exercise_id: 2, exercise_name: 'Squat', set_count: 3 },
    { exercise_id: 9, exercise_name: 'Leg Press', set_count: 2 },
    { exercise_id: 5, exercise_name: 'Calf Raise', set_count: 2 },
  ],
};

// Last time: Squat had two sets, Leg Press three (in kg); Calf Raise was never logged.
const LAST_SETS: ExerciseLastSets[] = [
  {
    exercise_id: 2,
    date: '2026-10-09',
    sets: [
      { reps: 5, weight: 225, unit: 'lb' },
      { reps: 3, weight: 245, unit: 'lb' },
    ],
  },
  {
    exercise_id: 9,
    date: '2026-10-06',
    sets: [
      { reps: 10, weight: 120, unit: 'kg' },
      { reps: 8, weight: 130.5, unit: 'kg' },
      { reps: 6, weight: 140, unit: 'kg' },
    ],
  },
];

describe('createLogForm', () => {
  it('starts on the given day with no notes and no exercises', () => {
    expect(createLogForm(TODAY)).toMatchObject({ date: TODAY, notes: '', exercises: [] });
  });
});

describe('logFormReducer', () => {
  it('adds an exercise with one empty set', () => {
    const form = apply(createLogForm(TODAY), { type: 'addExercise', exercise: SQUAT });

    expect(form.exercises).toEqual([
      {
        key: expect.any(Number),
        exerciseId: 2,
        name: 'Squat',
        // No hint (nothing to suggest) and not ticked: left untouched, it isn't saved.
        sets: [{ key: expect.any(Number), reps: '', weight: '', unit: 'lb', hint: null, ticked: false }],
        loading: false,
      },
    ]);
  });

  it('ignores adding an exercise that is already in the form', () => {
    const form = withSquat();

    expect(apply(form, { type: 'addExercise', exercise: SQUAT })).toBe(form);
  });

  it('gives every exercise and set its own key', () => {
    let form = apply(
      createLogForm(TODAY),
      { type: 'addExercise', exercise: SQUAT },
      { type: 'addExercise', exercise: BENCH }
    );
    form = apply(form, { type: 'addSet', exerciseKey: exerciseKey(form, 0) });

    const keys = [
      ...form.exercises.map((e) => e.key),
      ...form.exercises.flatMap((e) => e.sets.map((s) => s.key)),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("copies the previous set's values for + Add set", () => {
    let form = withSquat('5', '225');
    const key = exerciseKey(form, 0);
    const [first = -1] = setKeys(form, 0);
    form = apply(
      form,
      { type: 'updateSet', exerciseKey: key, setKey: first, change: { unit: 'kg' } },
      { type: 'addSet', exerciseKey: key }
    );

    expect(form.exercises[0]?.sets.map(({ reps, weight, unit }) => ({ reps, weight, unit }))).toEqual([
      { reps: '5', weight: '225', unit: 'kg' },
      { reps: '5', weight: '225', unit: 'kg' },
    ]);
  });

  it('adds an empty set when the exercise has none left', () => {
    let form = withSquat();
    const key = exerciseKey(form, 0);
    const [only = -1] = setKeys(form, 0);
    form = apply(form, { type: 'removeSet', exerciseKey: key, setKey: only }, { type: 'addSet', exerciseKey: key });

    expect(form.exercises[0]?.sets).toEqual([
      { key: expect.any(Number), reps: '', weight: '', unit: 'lb', hint: null, ticked: false },
    ]);
  });

  it("starts a new exercise's set in the unit used last", () => {
    let form = withSquat();
    const [first = -1] = setKeys(form, 0);
    form = apply(
      form,
      { type: 'updateSet', exerciseKey: exerciseKey(form, 0), setKey: first, change: { unit: 'kg' } },
      { type: 'addExercise', exercise: BENCH }
    );

    expect(form.exercises[1]?.sets[0]?.unit).toBe('kg');
  });

  it('changes only the targeted set', () => {
    let form = withSquat('5', '225');
    const key = exerciseKey(form, 0);
    form = apply(form, { type: 'addSet', exerciseKey: key });
    const [, second = -1] = setKeys(form, 0);
    form = apply(form, { type: 'updateSet', exerciseKey: key, setKey: second, change: { reps: '3' } });

    expect(form.exercises[0]?.sets.map((s) => s.reps)).toEqual(['5', '3']);
  });

  it('removes one set, and one exercise', () => {
    let form = apply(withSquat(), { type: 'addExercise', exercise: BENCH });
    const squatKey = exerciseKey(form, 0);
    form = apply(form, { type: 'addSet', exerciseKey: squatKey });
    const [firstSet = -1] = setKeys(form, 0);

    form = apply(
      form,
      { type: 'removeSet', exerciseKey: squatKey, setKey: firstSet },
      { type: 'removeExercise', exerciseKey: exerciseKey(form, 1) }
    );

    expect(form.exercises.map((e) => [e.name, e.sets.length])).toEqual([['Squat', 1]]);
  });

  it('sets the date and the notes', () => {
    const form = apply(
      createLogForm(TODAY),
      { type: 'setDate', date: '2026-10-11' },
      { type: 'setNotes', notes: 'Felt strong' }
    );

    expect(form).toMatchObject({ date: '2026-10-11', notes: 'Felt strong' });
  });

  it('does not change the form it was given (returns a new one)', () => {
    const before = withSquat();
    const snapshot = JSON.stringify(before);

    apply(before, { type: 'addSet', exerciseKey: exerciseKey(before, 0) }, { type: 'setNotes', notes: 'x' });

    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

describe('ticking sets', () => {
  it('ticks and unticks a set with ✓', () => {
    const form = apply(createLogForm(TODAY), { type: 'addExercise', exercise: SQUAT });

    expect(setAt(tick(form, 0, 0), 0, 0).ticked).toBe(true);
    expect(setAt(tick(tick(form, 0, 0), 0, 0), 0, 0).ticked).toBe(false);
  });

  it('ticks a set when reps or weight are typed into it, but not for a unit change', () => {
    const form = apply(createLogForm(TODAY), { type: 'addExercise', exercise: SQUAT });
    const unitOnly = apply(form, {
      type: 'updateSet',
      exerciseKey: exerciseKey(form, 0),
      setKey: setAt(form, 0, 0).key,
      change: { unit: 'kg' },
    });

    expect(setAt(typeInto(form, 0, 0, { reps: '5' }), 0, 0).ticked).toBe(true);
    expect(setAt(typeInto(form, 0, 0, { weight: '100' }), 0, 0).ticked).toBe(true);
    expect(setAt(unitOnly, 0, 0).ticked).toBe(false);
  });

  it('copies the previous set, hint and tick included, for + Add set', () => {
    const form = createLogFormFromTemplate(TODAY, LEG_DAY, LAST_SETS);
    const added = apply(form, { type: 'addSet', exerciseKey: exerciseKey(form, 0) });

    // Squat's third row has last time's last set as its hint, unticked; the copy is the same.
    expect(rowsOf(added, 0)?.at(-1)).toEqual(['', '', 'lb', { reps: '3', weight: '245' }, false]);
  });
});

describe('adding an exercise with last time as hints', () => {
  // Picked from the picker: added while last time is fetched, then filled in.
  function picked(form: LogForm, exercise = BENCH): LogForm {
    return apply(form, { type: 'addExercise', exercise, loading: true });
  }

  function fill(form: LogForm, index: number, lastSets: ExerciseLastSets['sets'] | null): LogForm {
    const exerciseId = form.exercises[index]?.exerciseId ?? -1;
    return apply(form, { type: 'fillLastSets', exerciseId, lastSets });
  }

  it('adds the exercise as loading, with no rows yet', () => {
    const form = picked(createLogForm(TODAY));

    expect(form.exercises).toEqual([
      { key: expect.any(Number), exerciseId: 1, name: 'Bench Press', sets: [], loading: true },
    ]);
  });

  it("then gives it one hinted, unticked row per set of last time, in that set's unit", () => {
    const form = fill(picked(createLogForm(TODAY)), 0, [
      { reps: 8, weight: 60, unit: 'kg' },
      { reps: 6, weight: 62.5, unit: 'kg' },
    ]);

    expect(form.exercises[0]?.loading).toBe(false);
    expect(rowsOf(form, 0)).toEqual([
      ['', '', 'kg', { reps: '8', weight: '60' }, false],
      ['', '', 'kg', { reps: '6', weight: '62.5' }, false],
    ]);
  });

  it('gives a never-logged exercise one empty row in the unit used last, as before', () => {
    let form = withSquat();
    form = apply(form, {
      type: 'updateSet',
      exerciseKey: exerciseKey(form, 0),
      setKey: setAt(form, 0, 0).key,
      change: { unit: 'kg' },
    });
    // The loading card has no rows, so "the unit used last" looks past it, to Squat's kg.
    form = fill(picked(form), 1, null);

    expect(rowsOf(form, 1)).toEqual([['', '', 'kg', null, false]]);
    expect(fill(picked(createLogForm(TODAY)), 0, [])).toEqual(
      fill(picked(createLogForm(TODAY)), 0, null)
    );
  });

  it('gives every new row its own key', () => {
    const form = fill(picked(withSquat()), 1, LAST_SETS[1]?.sets ?? null);
    const keys = form.exercises.flatMap((e) => [e.key, ...e.sets.map((s) => s.key)]);

    expect(new Set(keys).size).toBe(keys.length);
    expect(Math.max(...keys)).toBeLessThan(form.nextKey);
  });

  it('ignores last time arriving for a card that was removed or already filled', () => {
    const form = picked(createLogForm(TODAY));
    const key = exerciseKey(form, 0);
    const filled = fill(form, 0, null);
    const removed = apply(form, { type: 'removeExercise', exerciseKey: key });

    expect(fill(filled, 0, [{ reps: 1, weight: 1, unit: 'lb' }])).toBe(filled);
    expect(apply(removed, { type: 'fillLastSets', exerciseId: BENCH.id, lastSets: null })).toBe(
      removed
    );
  });

  it('adds no set to a card that is still loading', () => {
    const form = picked(createLogForm(TODAY));

    expect(apply(form, { type: 'addSet', exerciseKey: exerciseKey(form, 0) })).toBe(form);
  });

  it('saves nothing from a loading card', () => {
    const form = picked(withSquat());

    expect(validateLogForm(form).body?.sets).toEqual([
      { exercise_id: 2, reps: 5, weight: 225, unit: 'lb' },
    ]);
  });
});

describe('createLogFormFromTemplate', () => {
  it("lists the template's exercises in order, on the given day, with no notes", () => {
    const form = createLogFormFromTemplate(TODAY, LEG_DAY, LAST_SETS);

    expect(form).toMatchObject({ date: TODAY, notes: '' });
    expect(form.exercises.map((e) => [e.exerciseId, e.name, e.sets.length])).toEqual([
      [2, 'Squat', 3],
      [9, 'Leg Press', 2],
      [5, 'Calf Raise', 2],
    ]);
  });

  it("hints row i with last time's set i, and extra rows with last time's last set", () => {
    const form = createLogFormFromTemplate(TODAY, LEG_DAY, LAST_SETS);

    // Nothing typed or ticked: the numbers are only hints (shown as placeholders).
    expect(rowsOf(form, 0)).toEqual([
      ['', '', 'lb', { reps: '5', weight: '225' }, false],
      ['', '', 'lb', { reps: '3', weight: '245' }, false],
      ['', '', 'lb', { reps: '3', weight: '245' }, false],
    ]);
  });

  it("uses last time's first sets when the template has fewer, in their unit", () => {
    const form = createLogFormFromTemplate(TODAY, LEG_DAY, LAST_SETS);

    expect(rowsOf(form, 1)).toEqual([
      ['', '', 'kg', { reps: '10', weight: '120' }, false],
      ['', '', 'kg', { reps: '8', weight: '130.5' }, false],
    ]);
  });

  it('gives a never-logged exercise empty rows in the unit used last, as adding one does', () => {
    const form = createLogFormFromTemplate(TODAY, LEG_DAY, LAST_SETS);

    // The row before Calf Raise's is Leg Press's, in kg.
    expect(rowsOf(form, 2)).toEqual([
      ['', '', 'kg', null, false],
      ['', '', 'kg', null, false],
    ]);
  });

  it('starts a never-logged first exercise in lb, as an empty workout does', () => {
    const form = createLogFormFromTemplate(TODAY, LEG_DAY, []);

    expect(rowsOf(form, 0)?.map((row) => row[2])).toEqual(['lb', 'lb', 'lb']);
  });

  it('gives every exercise and set its own key, and keeps nextKey above them', () => {
    const form = createLogFormFromTemplate(TODAY, LEG_DAY, LAST_SETS);
    const keys = [
      ...form.exercises.map((e) => e.key),
      ...form.exercises.flatMap((e) => e.sets.map((s) => s.key)),
    ];

    expect(new Set(keys).size).toBe(keys.length);
    expect(Math.max(...keys)).toBeLessThan(form.nextKey);
  });
});

describe('validating a form started from a template', () => {
  const start = () => createLogFormFromTemplate(TODAY, LEG_DAY, LAST_SETS);

  it('saves nothing until a set is ticked, and says so', () => {
    const result = validateLogForm(start());

    expect(result.body).toBeNull();
    expect(result.setsError).toBe(NO_SETS_ERROR);
    expect(result.setErrors.size).toBe(0);
  });

  it('saves a ticked set with its hint values', () => {
    const form = tick(tick(start(), 0, 0), 1, 1);

    expect(validateLogForm(form).body).toEqual({
      date: TODAY,
      sets: [
        { exercise_id: 2, reps: 5, weight: 225, unit: 'lb' },
        { exercise_id: 9, reps: 8, weight: 130.5, unit: 'kg' },
      ],
    });
  });

  it('uses what was typed over the hint, field by field', () => {
    // Only reps typed (which ticked the row): the weight still comes from the hint.
    const form = typeInto(start(), 0, 1, { reps: '4' });

    expect(validateLogForm(form).body?.sets).toEqual([
      { exercise_id: 2, reps: 4, weight: 245, unit: 'lb' },
    ]);
  });

  it('drops a set that was unticked, even after typing into it', () => {
    const form = tick(typeInto(start(), 0, 0, { reps: '6', weight: '230' }), 0, 0);

    expect(validateLogForm(form)).toMatchObject({ body: null, setsError: NO_SETS_ERROR });
  });

  it('reports errors only for ticked sets, e.g. a never-logged one left blank', () => {
    const form = tick(start(), 2, 0); // Calf Raise: no hint, nothing typed
    const key = setAt(form, 2, 0).key;
    const result = validateLogForm(form);

    expect(result.body).toBeNull();
    expect(result.setsError).toBeNull();
    expect([...result.setErrors.keys()]).toEqual([key]);
    expect(result.setErrors.get(key)).toEqual({
      reps: 'Reps must be a whole number.',
      weight: 'Weight must be a number up to 9999.99, with at most 2 decimals.',
    });
  });
});

describe('hasChanges', () => {
  const empty = createLogForm(TODAY);

  it('is false for a new form', () => {
    expect(hasChanges(createLogForm(TODAY), empty)).toBe(false);
  });

  it('is true after adding an exercise, writing notes, or changing the date', () => {
    expect(hasChanges(withSquat(), empty)).toBe(true);
    expect(hasChanges(apply(empty, { type: 'setNotes', notes: 'x' }), empty)).toBe(true);
    expect(hasChanges(apply(empty, { type: 'setDate', date: '2026-10-12' }), empty)).toBe(true);
  });

  it('ignores notes that are only spaces', () => {
    expect(hasChanges(apply(empty, { type: 'setNotes', notes: '  ' }), empty)).toBe(false);
  });

  it('compares against the starting form, so a prefilled form left untouched has no changes', () => {
    const initial = createLogFormFromTemplate(TODAY, LEG_DAY, LAST_SETS);

    expect(hasChanges(initial, initial)).toBe(false);
    expect(hasChanges(tick(initial, 0, 0), initial)).toBe(true);
    // Ticked, then unticked: back where it started.
    expect(hasChanges(tick(tick(initial, 0, 0), 0, 0), initial)).toBe(false);
  });
});

describe('validateLogForm', () => {
  // The server numbers sets in the order sent and rejects a set_number, so form order is all that
  // matters. toEqual fails on any extra key, so a leftover set_number would show.
  it('builds the POST body with the sets in form order, without set numbers', () => {
    let form = withSquat('5', '225');
    const squatKey = exerciseKey(form, 0);
    form = apply(form, { type: 'addSet', exerciseKey: squatKey }, { type: 'addExercise', exercise: BENCH });
    const [, secondSquat = -1] = setKeys(form, 0);
    const [bench = -1] = setKeys(form, 1);
    form = apply(
      form,
      { type: 'updateSet', exerciseKey: squatKey, setKey: secondSquat, change: { reps: '3' } },
      {
        type: 'updateSet',
        exerciseKey: exerciseKey(form, 1),
        setKey: bench,
        change: { reps: '8', weight: '60,5', unit: 'kg' },
      }
    );

    const result = validateLogForm(form);

    expect(result.validSetCount).toBe(3);
    expect(result.body).toEqual({
      date: TODAY,
      sets: [
        { exercise_id: 2, reps: 5, weight: 225, unit: 'lb' },
        { exercise_id: 2, reps: 3, weight: 225, unit: 'lb' },
        { exercise_id: 1, reps: 8, weight: 60.5, unit: 'kg' },
      ],
    });
  });

  it('sends trimmed notes, and leaves them out when blank', () => {
    const withNotes = apply(withSquat(), { type: 'setNotes', notes: '  Heavy day ' });

    expect(validateLogForm(withNotes).body).toMatchObject({ notes: 'Heavy day' });
    expect(validateLogForm(withSquat()).body).not.toHaveProperty('notes');
  });

  it('skips an exercise whose sets were all removed', () => {
    let form = apply(withSquat(), { type: 'addExercise', exercise: BENCH });
    const [bench = -1] = setKeys(form, 1);
    form = apply(form, { type: 'removeSet', exerciseKey: exerciseKey(form, 1), setKey: bench });

    expect(validateLogForm(form).body?.sets.map((s) => s.exercise_id)).toEqual([2]);
  });

  it('reports errors per field, and builds no body while any set is invalid', () => {
    let form = withSquat('5', '1.234');
    form = apply(form, { type: 'addSet', exerciseKey: exerciseKey(form, 0) });
    const [bad = -1, copy = -1] = setKeys(form, 0);
    form = apply(form, {
      type: 'updateSet',
      exerciseKey: exerciseKey(form, 0),
      setKey: copy,
      change: { reps: '', weight: '100' },
    });

    const result = validateLogForm(form);

    expect(result.body).toBeNull();
    expect(result.validSetCount).toBe(0);
    expect(result.setErrors.get(bad)).toEqual({
      reps: null,
      weight: 'Weight must be a number up to 9999.99, with at most 2 decimals.',
    });
    expect(result.setErrors.get(copy)).toEqual({ reps: 'Reps must be a whole number.', weight: null });
  });

  it('counts valid sets even when another set is invalid', () => {
    let form = withSquat('5', '225');
    form = apply(form, { type: 'addExercise', exercise: BENCH });
    form = typeInto(form, 1, 0, { reps: 'x' });

    const result = validateLogForm(form);

    expect(result.validSetCount).toBe(1);
    expect(result.body).toBeNull();
  });

  it('skips a set that was never ticked or typed into, without an error', () => {
    let form = withSquat('5', '225');
    form = apply(form, { type: 'addExercise', exercise: BENCH }); // Bench's set is untouched

    const result = validateLogForm(form);

    expect(result.setErrors.has(setAt(form, 1, 0).key)).toBe(false);
    expect(result.body?.sets).toEqual([{ exercise_id: 2, reps: 5, weight: 225, unit: 'lb' }]);
  });

  it('builds no body when there are no sets, and says to tick one', () => {
    expect(validateLogForm(createLogForm(TODAY))).toMatchObject({
      validSetCount: 0,
      body: null,
      setsError: NO_SETS_ERROR,
    });
    expect(validateLogForm(withSquat()).setsError).toBeNull();
  });

  it('reports an invalid date', () => {
    const form = apply(withSquat(), { type: 'setDate', date: '2026-02-30' });

    const result = validateLogForm(form);

    expect(result.dateError).toBe('Enter a real date as YYYY-MM-DD.');
    expect(result.body).toBeNull();
  });
});
