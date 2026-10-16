import {
  createLogForm,
  hasChanges,
  logFormReducer,
  validateLogForm,
  type LogAction,
  type LogForm,
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
        sets: [{ key: expect.any(Number), reps: '', weight: '', unit: 'lb' }],
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

    expect(form.exercises[0]?.sets).toEqual([{ key: expect.any(Number), reps: '', weight: '', unit: 'lb' }]);
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

describe('hasChanges', () => {
  it('is false for a new form', () => {
    expect(hasChanges(createLogForm(TODAY), TODAY)).toBe(false);
  });

  it('is true after adding an exercise, writing notes, or changing the date', () => {
    expect(hasChanges(withSquat(), TODAY)).toBe(true);
    expect(hasChanges(apply(createLogForm(TODAY), { type: 'setNotes', notes: 'x' }), TODAY)).toBe(true);
    expect(hasChanges(apply(createLogForm(TODAY), { type: 'setDate', date: '2026-10-12' }), TODAY)).toBe(true);
  });

  it('ignores notes that are only spaces', () => {
    expect(hasChanges(apply(createLogForm(TODAY), { type: 'setNotes', notes: '  ' }), TODAY)).toBe(false);
  });
});

describe('validateLogForm', () => {
  // No set_number in the body: the server numbers each exercise's sets in the order they're sent
  // (and rejects a body that has one), so form order is all that matters. toEqual fails on any
  // extra key, so a set_number left in would fail this test.
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
    form = apply(form, { type: 'addExercise', exercise: BENCH }); // Bench's set is still empty

    const result = validateLogForm(form);

    expect(result.validSetCount).toBe(1);
    expect(result.body).toBeNull();
  });

  it('builds no body when there are no sets', () => {
    expect(validateLogForm(createLogForm(TODAY))).toMatchObject({ validSetCount: 0, body: null });
  });

  it('reports an invalid date', () => {
    const form = apply(withSquat(), { type: 'setDate', date: '2026-02-30' });

    const result = validateLogForm(form);

    expect(result.dateError).toBe('Enter a real date as YYYY-MM-DD.');
    expect(result.body).toBeNull();
  });
});
