import type { TemplateDetail } from '@shared/models';

import {
  createTemplateForm,
  DEFAULT_SET_COUNT,
  MAX_SET_COUNT,
  templateFormChanged,
  templateFormFrom,
  templateFormReducer,
  validateTemplateForm,
  type TemplateAction,
  type TemplateForm,
} from './template-form';

const SQUAT = { id: 2, name: 'Squat' };
const BENCH = { id: 1, name: 'Bench Press' };
const ROW = { id: 7, name: 'Row' };

// Applies actions in order, like the screen dispatching them one by one.
function apply(form: TemplateForm, ...actions: TemplateAction[]): TemplateForm {
  return actions.reduce(templateFormReducer, form);
}

// The key the form gave the nth exercise, for actions that target it.
function keyAt(form: TemplateForm, index: number): number {
  const exercise = form.exercises[index];
  if (!exercise) throw new Error(`No exercise ${index}`);
  return exercise.key;
}

// What the user sees: [exercise name, set count] per row, in order.
function rows(form: TemplateForm): [string, number][] {
  return form.exercises.map((e) => [e.name, e.setCount]);
}

function withThree(): TemplateForm {
  return apply(
    createTemplateForm(),
    { type: 'addExercise', exercise: SQUAT },
    { type: 'addExercise', exercise: BENCH },
    { type: 'addExercise', exercise: ROW }
  );
}

const LEG_DAY: TemplateDetail = {
  id: 4,
  name: 'Leg day',
  exercises: [
    { exercise_id: 2, exercise_name: 'Squat', set_count: 5 },
    { exercise_id: 9, exercise_name: 'Leg Press', set_count: 3 },
  ],
};

describe('createTemplateForm', () => {
  it('starts with no name and no exercises', () => {
    expect(createTemplateForm()).toMatchObject({ name: '', exercises: [] });
  });
});

describe('templateFormFrom', () => {
  it("holds a saved template's name and exercises in order, for editing", () => {
    const form = templateFormFrom(LEG_DAY);

    expect(form.name).toBe('Leg day');
    expect(rows(form)).toEqual([
      ['Squat', 5],
      ['Leg Press', 3],
    ]);
    expect(form.exercises.map((e) => e.exerciseId)).toEqual([2, 9]);
  });

  it('gives every row its own key, and keeps nextKey above them', () => {
    const form = templateFormFrom(LEG_DAY);
    const keys = form.exercises.map((e) => e.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(Math.max(...keys)).toBeLessThan(form.nextKey);
  });
});

describe('templateFormReducer', () => {
  it('sets the name as typed (trimmed only when saving)', () => {
    expect(apply(createTemplateForm(), { type: 'setName', name: ' Leg day ' }).name).toBe(' Leg day ');
  });

  it(`adds an exercise at the end with ${DEFAULT_SET_COUNT} sets`, () => {
    expect(rows(withThree())).toEqual([
      ['Squat', DEFAULT_SET_COUNT],
      ['Bench Press', DEFAULT_SET_COUNT],
      ['Row', DEFAULT_SET_COUNT],
    ]);
  });

  it('ignores an exercise that is already in the template, returning the same state', () => {
    const form = withThree();

    // toBe: the same object, which tells React nothing changed.
    expect(apply(form, { type: 'addExercise', exercise: SQUAT })).toBe(form);
  });

  it('removes an exercise by key', () => {
    const form = withThree();

    expect(rows(apply(form, { type: 'removeExercise', exerciseKey: keyAt(form, 1) }))).toEqual([
      ['Squat', 3],
      ['Row', 3],
    ]);
  });

  it('can add an exercise again after removing it, with a new key', () => {
    const form = withThree();
    const removed = apply(form, { type: 'removeExercise', exerciseKey: keyAt(form, 0) });

    const readded = apply(removed, { type: 'addExercise', exercise: SQUAT });

    expect(rows(readded).map(([name]) => name)).toEqual(['Bench Press', 'Row', 'Squat']);
    expect(keyAt(readded, 2)).not.toBe(keyAt(form, 0));
  });

  it("changes one exercise's set count by a step, leaving the others", () => {
    const form = withThree();
    const key = keyAt(form, 1);

    const changed = apply(
      form,
      { type: 'changeSetCount', exerciseKey: key, by: 1 },
      { type: 'changeSetCount', exerciseKey: key, by: 1 }
    );

    expect(rows(changed)).toEqual([
      ['Squat', 3],
      ['Bench Press', 5],
      ['Row', 3],
    ]);
  });

  it(`keeps the set count between 1 and ${MAX_SET_COUNT}, as the server requires`, () => {
    const form = apply(createTemplateForm(), { type: 'addExercise', exercise: SQUAT });
    const key = keyAt(form, 0);

    // `times` taps of − (by: -1) or + (by: 1) on the stepper.
    const taps = (by: number, times: number) =>
      Array.from({ length: times }, (): TemplateAction => ({ type: 'changeSetCount', exerciseKey: key, by }));

    const down = apply(form, ...taps(-1, 5));
    const up = apply(form, ...taps(1, 30));

    expect(rows(down)).toEqual([['Squat', 1]]);
    expect(rows(up)).toEqual([['Squat', MAX_SET_COUNT]]);
  });

  it('returns the same state for a step past either limit', () => {
    const form = apply(createTemplateForm(), { type: 'addExercise', exercise: SQUAT });
    const atOne = apply(form, { type: 'changeSetCount', exerciseKey: keyAt(form, 0), by: -2 });

    expect(apply(atOne, { type: 'changeSetCount', exerciseKey: keyAt(atOne, 0), by: -1 })).toBe(atOne);
  });

  it('moves an exercise up or down one place', () => {
    const form = withThree();

    const rowUp = apply(form, { type: 'moveExercise', exerciseKey: keyAt(form, 2), direction: 'up' });
    const squatDown = apply(form, { type: 'moveExercise', exerciseKey: keyAt(form, 0), direction: 'down' });

    expect(rows(rowUp).map(([name]) => name)).toEqual(['Squat', 'Row', 'Bench Press']);
    expect(rows(squatDown).map(([name]) => name)).toEqual(['Bench Press', 'Squat', 'Row']);
  });

  it('keeps each row its key when it moves', () => {
    const form = withThree();
    const rowKey = keyAt(form, 2);

    const moved = apply(form, { type: 'moveExercise', exerciseKey: rowKey, direction: 'up' });

    expect(keyAt(moved, 1)).toBe(rowKey);
  });

  it('returns the same state when moving the first up or the last down', () => {
    const form = withThree();

    expect(apply(form, { type: 'moveExercise', exerciseKey: keyAt(form, 0), direction: 'up' })).toBe(form);
    expect(apply(form, { type: 'moveExercise', exerciseKey: keyAt(form, 2), direction: 'down' })).toBe(form);
  });

  it("doesn't change the state it was given", () => {
    const form = withThree();
    const before = structuredClone(form);

    apply(
      form,
      { type: 'setName', name: 'x' },
      { type: 'changeSetCount', exerciseKey: keyAt(form, 0), by: 1 },
      { type: 'moveExercise', exerciseKey: keyAt(form, 1), direction: 'up' },
      { type: 'removeExercise', exerciseKey: keyAt(form, 2) }
    );

    expect(form).toEqual(before);
  });
});

describe('validateTemplateForm', () => {
  it('builds the body: the name trimmed, exercises in order with their set counts', () => {
    const form = apply(
      withThree(),
      { type: 'setName', name: '  Full body ' },
      { type: 'changeSetCount', exerciseKey: keyAt(withThree(), 1), by: 2 }
    );

    expect(validateTemplateForm(form)).toEqual({
      nameError: null,
      exercisesError: null,
      body: {
        name: 'Full body',
        exercises: [
          { exercise_id: SQUAT.id, set_count: 3 },
          { exercise_id: BENCH.id, set_count: 5 },
          { exercise_id: ROW.id, set_count: 3 },
        ],
      },
    });
  });

  it.each([
    ['empty', ''],
    ['only spaces', '   '],
    ['over 100 characters', 'x'.repeat(101)],
  ])('rejects a name that is %s, with the server\'s message', (_label, name) => {
    const result = validateTemplateForm(apply(withThree(), { type: 'setName', name }));

    expect(result.nameError).toBe('Template names must be 1 to 100 characters');
    expect(result.body).toBeNull();
  });

  it('counts the name in characters as the server does, so 100 emoji fit', () => {
    // Each 💪 is one character but two UTF-16 units: its .length is 2.
    const result = validateTemplateForm(apply(withThree(), { type: 'setName', name: '💪'.repeat(100) }));

    expect(result.nameError).toBeNull();
  });

  it('requires at least one exercise', () => {
    const result = validateTemplateForm(apply(createTemplateForm(), { type: 'setName', name: 'Leg day' }));

    expect(result.exercisesError).toBe('Add at least one exercise.');
    expect(result.body).toBeNull();
  });

  it('reports both problems at once', () => {
    const result = validateTemplateForm(createTemplateForm());

    expect(result.nameError).not.toBeNull();
    expect(result.exercisesError).not.toBeNull();
  });
});

describe('templateFormChanged', () => {
  it('is false for the form as it started, new or loaded for editing', () => {
    expect(templateFormChanged(createTemplateForm(), createTemplateForm())).toBe(false);
    expect(templateFormChanged(templateFormFrom(LEG_DAY), templateFormFrom(LEG_DAY))).toBe(false);
  });

  it('is false when only spaces around the name changed', () => {
    const initial = templateFormFrom(LEG_DAY);

    expect(templateFormChanged(apply(initial, { type: 'setName', name: ' Leg day  ' }), initial)).toBe(false);
  });

  it('is false after changes that cancel out, like a move up and back down', () => {
    const initial = templateFormFrom(LEG_DAY);
    const key = keyAt(initial, 1);

    const back = apply(
      initial,
      { type: 'moveExercise', exerciseKey: key, direction: 'up' },
      { type: 'moveExercise', exerciseKey: key, direction: 'down' }
    );

    expect(templateFormChanged(back, initial)).toBe(false);
  });

  it('is true for a new name, a set count, a new order, or an added or removed exercise', () => {
    const initial = templateFormFrom(LEG_DAY);
    const first = keyAt(initial, 0);

    expect(templateFormChanged(apply(initial, { type: 'setName', name: 'Legs' }), initial)).toBe(true);
    expect(templateFormChanged(apply(initial, { type: 'changeSetCount', exerciseKey: first, by: 1 }), initial)).toBe(true);
    expect(templateFormChanged(apply(initial, { type: 'moveExercise', exerciseKey: first, direction: 'down' }), initial)).toBe(true);
    expect(templateFormChanged(apply(initial, { type: 'addExercise', exercise: ROW }), initial)).toBe(true);
    expect(templateFormChanged(apply(initial, { type: 'removeExercise', exerciseKey: first }), initial)).toBe(true);
  });

  it('is true when an exercise is removed and added back (it moves to the end)', () => {
    const initial = templateFormFrom(LEG_DAY);

    const readded = apply(
      initial,
      { type: 'removeExercise', exerciseKey: keyAt(initial, 0) },
      { type: 'addExercise', exercise: { id: 2, name: 'Squat' } }
    );

    expect(templateFormChanged(readded, initial)).toBe(true);
  });
});
