import type { Exercise } from '@shared/models';

import { searchExercises } from './exercise-search';

function exercise(id: number, name: string, muscle_group: string | null = null): Exercise {
  return { id, name, muscle_group, created_by: null };
}

const ALL = [
  exercise(1, 'Squat', 'Legs'),
  exercise(2, 'Bench Press', 'Chest'),
  exercise(3, 'Front Squat', 'Legs'),
  exercise(4, 'deadlift', 'Back'),
];

describe('searchExercises', () => {
  it('lists everything, sorted by name ignoring case, for an empty search', () => {
    expect(searchExercises(ALL, '', []).map((e) => e.name)).toEqual([
      'Bench Press',
      'deadlift',
      'Front Squat',
      'Squat',
    ]);
  });

  it('matches part of a name, ignoring case and surrounding spaces', () => {
    expect(searchExercises(ALL, '  SQU ', []).map((e) => e.id)).toEqual([3, 1]);
  });

  it('matches the muscle group too', () => {
    expect(searchExercises(ALL, 'chest', []).map((e) => e.id)).toEqual([2]);
  });

  it('leaves out the excluded ids (exercises already in the workout)', () => {
    expect(searchExercises(ALL, 'squat', [1]).map((e) => e.id)).toEqual([3]);
  });
});
