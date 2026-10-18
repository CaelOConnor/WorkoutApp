import type { TemplateDetail, WorkoutDetailSet } from '@shared/models';

import { exerciseNames, setCountLabel, templateSummary } from './summary';

// A full set with sensible defaults; `overrides` replaces only the fields a test cares about.
// Partial<T> makes every field optional, and the spread puts the overrides on top.
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

describe('exerciseNames', () => {
  it('lists each exercise once, in the order first done', () => {
    const sets = [
      set({ exercise_id: 1, exercise_name: 'Squat' }),
      set({ exercise_id: 1, exercise_name: 'Squat' }),
      set({ exercise_id: 2, exercise_name: 'Bench Press' }),
      set({ exercise_id: 1, exercise_name: 'Squat' }),
    ];

    expect(exerciseNames(sets)).toBe('Squat, Bench Press');
  });

  it('says so when a workout has no sets', () => {
    expect(exerciseNames([])).toBe('No exercises');
  });
});

describe('setCountLabel', () => {
  it('uses the singular for one set', () => {
    expect(setCountLabel(0)).toBe('0 sets');
    expect(setCountLabel(1)).toBe('1 set');
    expect(setCountLabel(12)).toBe('12 sets');
  });
});

describe('templateSummary', () => {
  it('lists each exercise with its set count, in order', () => {
    const template: TemplateDetail = {
      id: 1,
      name: 'Leg day',
      exercises: [
        { exercise_id: 2, exercise_name: 'Squat', set_count: 3 },
        { exercise_id: 5, exercise_name: 'RDL', set_count: 3 },
        { exercise_id: 7, exercise_name: 'Leg press', set_count: 4 },
      ],
    };

    expect(templateSummary(template)).toBe('Squat 3 · RDL 3 · Leg press 4');
  });
});
