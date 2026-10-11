import type {
  Exercise,
  LoginResponse,
  PublicUser,
  WorkoutDetail,
  WorkoutDetailSet,
} from '@shared/models';

import {
  isErrorResponse,
  isExerciseList,
  isLoginResponse,
  isNoContent,
  isPublicUser,
  isWorkoutDetail,
  isWorkoutDetailList,
} from './types';

// Valid examples of each response. `satisfies` checks the object against the shared type
// (so a field renamed in models.ts breaks this file at compile time) without widening it,
// so `{ ...validSet, reps: -1 }` below still knows every key.
const validLogin = { token: 'abc.def.ghi', email: 'a@example.com' } satisfies LoginResponse;
const validUser = { id: 1, email: 'a@example.com' } satisfies PublicUser;
const validExercise = {
  id: 1,
  name: 'Squat',
  muscle_group: 'legs',
  created_by: null,
} satisfies Exercise;
const validSet = {
  id: 10,
  exercise_id: 1,
  set_number: 1,
  reps: 5,
  weight: '135.00',
  unit: 'lb',
  exercise_name: 'Squat',
} satisfies WorkoutDetailSet;
const validWorkout = {
  id: 3,
  date: '2026-10-11',
  notes: null,
  sets: [validSet],
} satisfies WorkoutDetail;

describe('isLoginResponse', () => {
  it('accepts a login response', () => {
    expect(isLoginResponse(validLogin)).toBe(true);
  });

  // it.each runs the same test once per row; %s puts the row's first value in the test name.
  it.each([
    ['null', null],
    ['an array', [validLogin]],
    ['a missing token', { email: 'a@example.com' }],
    ['an empty token', { ...validLogin, token: '' }],
    ['a numeric email', { ...validLogin, email: 5 }],
  ])('rejects %s', (_label, value) => {
    expect(isLoginResponse(value)).toBe(false);
  });
});

describe('isPublicUser', () => {
  it('accepts a user', () => {
    expect(isPublicUser(validUser)).toBe(true);
  });

  it.each([
    ['a string id', { ...validUser, id: '1' }],
    ['a zero id', { ...validUser, id: 0 }],
    ['a missing email', { id: 1 }],
  ])('rejects %s', (_label, value) => {
    expect(isPublicUser(value)).toBe(false);
  });
});

describe('isExerciseList', () => {
  it('accepts an empty list', () => {
    expect(isExerciseList([])).toBe(true);
  });

  it('accepts built-in and custom exercises', () => {
    const custom = { ...validExercise, id: 2, muscle_group: null, created_by: 7 };
    expect(isExerciseList([validExercise, custom])).toBe(true);
  });

  it.each([
    ['a single exercise (not a list)', validExercise],
    ['a missing name', [{ ...validExercise, name: undefined }]],
    ['an undefined muscle_group (must be string or null)', [{ ...validExercise, muscle_group: undefined }]],
    ['a string created_by', [{ ...validExercise, created_by: '7' }]],
    ['one bad item among good ones', [validExercise, { ...validExercise, id: -1 }]],
  ])('rejects %s', (_label, value) => {
    expect(isExerciseList(value)).toBe(false);
  });
});

describe('isWorkoutDetail', () => {
  it('accepts a workout with sets', () => {
    expect(isWorkoutDetail(validWorkout)).toBe(true);
  });

  it('accepts an empty workout with notes', () => {
    expect(isWorkoutDetail({ ...validWorkout, notes: 'Felt good', sets: [] })).toBe(true);
  });

  it('allows keys it does not know about', () => {
    // Responses are allowed to grow: an extra field from a newer server shouldn't break the app.
    expect(isWorkoutDetail({ ...validWorkout, user_id: 1 })).toBe(true);
  });

  it.each([
    ['a full timestamp as the date', { ...validWorkout, date: '2026-10-11T00:00:00.000Z' }],
    ['missing sets', { ...validWorkout, sets: undefined }],
    ['undefined notes (must be string or null)', { ...validWorkout, notes: undefined }],
    ['a set with negative reps', { ...validWorkout, sets: [{ ...validSet, reps: -1 }] }],
    ['a set with a numeric weight', { ...validWorkout, sets: [{ ...validSet, weight: 135 }] }],
    ['a set with a non-numeric weight', { ...validWorkout, sets: [{ ...validSet, weight: 'heavy' }] }],
    ['a set with an unknown unit', { ...validWorkout, sets: [{ ...validSet, unit: 'stone' }] }],
    ['a set without exercise_name', { ...validWorkout, sets: [{ ...validSet, exercise_name: undefined }] }],
  ])('rejects %s', (_label, value) => {
    expect(isWorkoutDetail(value)).toBe(false);
  });
});

describe('isWorkoutDetailList', () => {
  it('accepts a list of workouts', () => {
    expect(isWorkoutDetailList([validWorkout, { ...validWorkout, id: 4, sets: [] }])).toBe(true);
  });

  it('rejects a single workout (not a list)', () => {
    expect(isWorkoutDetailList(validWorkout)).toBe(false);
  });

  it('rejects a list with a bad workout', () => {
    expect(isWorkoutDetailList([validWorkout, { id: 4 }])).toBe(false);
  });
});

describe('isErrorResponse', () => {
  it('accepts { error }', () => {
    expect(isErrorResponse({ error: 'Workout not found' })).toBe(true);
  });

  it.each([
    ['a numeric error', { error: 404 }],
    ['an object without error', { message: 'nope' }],
    ['a string', 'Cannot GET /nope'],
  ])('rejects %s', (_label, value) => {
    expect(isErrorResponse(value)).toBe(false);
  });
});

describe('isNoContent', () => {
  // The client hands this guard `undefined` for a 204 (DELETE), which has no body to parse.
  it('accepts undefined', () => {
    expect(isNoContent(undefined)).toBe(true);
  });

  it('rejects a body', () => {
    expect(isNoContent({})).toBe(false);
  });
});
