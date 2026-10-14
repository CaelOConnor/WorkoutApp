import type { WorkoutDetailSet } from '@shared/models';

import {
  addedSet,
  formatSetLine,
  groupSetsByExercise,
  parseRouteId,
} from './detail';

// A full set with sensible defaults; `overrides` replaces only the fields a test cares about.
function set(overrides: Partial<WorkoutDetailSet>): WorkoutDetailSet {
  return {
    id: 1,
    exercise_id: 1,
    set_number: 1,
    reps: 5,
    weight: 100,
    unit: 'lb',
    exercise_name: 'Squat',
    ...overrides,
  };
}

const SQUAT = { exercise_id: 1, exercise_name: 'Squat' };
const BENCH = { exercise_id: 2, exercise_name: 'Bench Press' };

describe('groupSetsByExercise', () => {
  it('returns no groups for no sets', () => {
    expect(groupSetsByExercise([])).toEqual([]);
  });

  it('groups by exercise in order of first appearance, keeping set order within each', () => {
    const sets = [
      set({ id: 10, set_number: 1, ...BENCH }),
      set({ id: 11, set_number: 2, ...SQUAT }),
      set({ id: 12, set_number: 3, ...BENCH }),
      set({ id: 13, set_number: 4, ...SQUAT }),
    ];

    const groups = groupSetsByExercise(sets);

    expect(groups.map((g) => [g.exerciseId, g.exerciseName, g.sets.map((s) => s.id)])).toEqual([
      [2, 'Bench Press', [10, 12]],
      [1, 'Squat', [11, 13]],
    ]);
  });

  it('keeps two exercises with the same name apart (grouped by id)', () => {
    const groups = groupSetsByExercise([
      set({ id: 1, exercise_id: 1, exercise_name: 'Squat' }),
      set({ id: 2, exercise_id: 9, exercise_name: 'Squat' }),
    ]);

    expect(groups.map((g) => g.exerciseId)).toEqual([1, 9]);
  });
});

describe('formatSetLine', () => {
  it('numbers by position, not the stored set_number', () => {
    // Stored set_number 7 (gaps after deletes, or interleaved with another exercise).
    const line = formatSetLine(set({ set_number: 7, reps: 5, weight: 225, unit: 'lb' }), 0);

    expect(line).toBe('Set 1 · 5 reps × 225 lb');
  });

  it('uses the singular for one rep, and shows kg', () => {
    expect(formatSetLine(set({ reps: 1, weight: 102.5, unit: 'kg' }), 2)).toBe(
      'Set 3 · 1 rep × 102.5 kg'
    );
  });
});

describe('parseRouteId', () => {
  it('accepts a positive integer id', () => {
    expect(parseRouteId('42')).toBe(42);
  });

  it.each([undefined, '', 'abc', '0', '-1', '1.5', '01', '1e3', '2147483648', ['1', '2']])(
    'rejects %p',
    (value) => {
      expect(parseRouteId(value)).toBeNull();
    }
  );
});

describe('addedSet', () => {
  it('finds the set that is in the new list but not the old one', () => {
    const before = [set({ id: 1 }), set({ id: 2 })];
    const after = [set({ id: 1 }), set({ id: 5, exercise_id: 3 }), set({ id: 2 })];

    expect(addedSet(before, after)?.id).toBe(5);
  });

  it('is undefined when nothing was added', () => {
    expect(addedSet([set({ id: 1 })], [set({ id: 1 })])).toBeUndefined();
  });
});
