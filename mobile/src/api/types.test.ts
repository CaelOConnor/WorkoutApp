import type {
  Exercise,
  ExerciseLastSets,
  ExerciseProgress,
  LoggedExercise,
  LoginResponse,
  PublicUser,
  TemplateDetail,
  WorkoutDetail,
  WorkoutDetailSet,
} from '@shared/models';

import {
  isCreateWorkoutResponse,
  isErrorResponse,
  isExerciseLastSetsList,
  isExerciseList,
  isExerciseProgress,
  isLoggedExerciseList,
  isLoginResponse,
  isNoContent,
  isPublicUser,
  isTemplateDetail,
  isTemplateDetailList,
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
  weight: 135,
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
    // The old string form: an app built against the new server should fail loudly on an old one.
    ['a set with a string weight', { ...validWorkout, sets: [{ ...validSet, weight: '135.00' }] }],
    ['a set with a negative weight', { ...validWorkout, sets: [{ ...validSet, weight: -5 }] }],
    // typeof NaN is 'number', so a typeof check alone would let these through.
    ['a set with a NaN weight', { ...validWorkout, sets: [{ ...validSet, weight: Number.NaN }] }],
    ['a set with an infinite weight', { ...validWorkout, sets: [{ ...validSet, weight: Infinity }] }],
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

describe('isCreateWorkoutResponse', () => {
  it('accepts the new id', () => {
    expect(isCreateWorkoutResponse({ id: 7 })).toBe(true);
  });

  it.each([null, {}, { id: '7' }, { id: 0 }, { id: 1.5 }, [{ id: 7 }]])('rejects %p', (value) => {
    expect(isCreateWorkoutResponse(value)).toBe(false);
  });
});

describe('isExerciseProgress', () => {
  const validPoint = { date: '2026-09-03', top_weight: 105, volume: 1325, sets: 2 };
  const validProgress = {
    exercise_id: 1,
    exercise_name: 'Squat',
    unit: 'kg',
    points: [validPoint],
  } satisfies ExerciseProgress;

  it('accepts progress with points, and with none', () => {
    expect(isExerciseProgress(validProgress)).toBe(true);
    expect(isExerciseProgress({ ...validProgress, points: [] })).toBe(true);
  });

  it('accepts zeros (bodyweight sets)', () => {
    const zeros = { ...validPoint, top_weight: 0, volume: 0 };
    expect(isExerciseProgress({ ...validProgress, points: [zeros] })).toBe(true);
  });

  it.each([
    ['an unknown unit', { ...validProgress, unit: 'stone' }],
    ['missing points', { ...validProgress, points: undefined }],
    ['a missing exercise_name', { ...validProgress, exercise_name: undefined }],
    ['a point with a timestamp date', { ...validProgress, points: [{ ...validPoint, date: '2026-09-03T00:00:00Z' }] }],
    ['a point with a string metric', { ...validProgress, points: [{ ...validPoint, top_weight: '105' }] }],
    ['a point with a negative volume', { ...validProgress, points: [{ ...validPoint, volume: -1 }] }],
    ['a point with NaN', { ...validProgress, points: [{ ...validPoint, top_weight: Number.NaN }] }],
    ['a point with 0 sets (every point has at least one)', { ...validProgress, points: [{ ...validPoint, sets: 0 }] }],
  ])('rejects %s', (_label, value) => {
    expect(isExerciseProgress(value)).toBe(false);
  });
});

describe('isLoggedExerciseList', () => {
  const validLogged = { id: 1, name: 'Squat', last_date: '2026-09-03', unit: 'lb' } satisfies LoggedExercise;

  it('accepts a list, including an empty one', () => {
    expect(isLoggedExerciseList([validLogged, { ...validLogged, id: 2, unit: 'kg' }])).toBe(true);
    expect(isLoggedExerciseList([])).toBe(true);
  });

  it.each([
    ['a single item (not a list)', validLogged],
    ['a missing last_date', [{ ...validLogged, last_date: undefined }]],
    ['an unknown unit', [{ ...validLogged, unit: 'st' }]],
    ['a zero id', [{ ...validLogged, id: 0 }]],
  ])('rejects %s', (_label, value) => {
    expect(isLoggedExerciseList(value)).toBe(false);
  });
});

describe('isTemplateDetail and isTemplateDetailList', () => {
  const validTemplate = {
    id: 4,
    name: 'Leg day',
    exercises: [
      { exercise_id: 1, exercise_name: 'Squat', set_count: 3 },
      { exercise_id: 2, exercise_name: 'Leg Press', set_count: 20 },
    ],
  } satisfies TemplateDetail;

  it('accepts a template, and a list of them (including an empty one)', () => {
    expect(isTemplateDetail(validTemplate)).toBe(true);
    expect(isTemplateDetailList([validTemplate, { ...validTemplate, id: 5 }])).toBe(true);
    expect(isTemplateDetailList([])).toBe(true);
  });

  it('allows extra keys, so a newer server can add fields', () => {
    expect(isTemplateDetail({ ...validTemplate, created_at: '2026-10-17' })).toBe(true);
  });

  const exercise = validTemplate.exercises[0];
  it.each([
    ['a missing name', { ...validTemplate, name: undefined }],
    ['an empty name', { ...validTemplate, name: '' }],
    ['a zero id', { ...validTemplate, id: 0 }],
    ['missing exercises', { ...validTemplate, exercises: undefined }],
    // The server requires at least one exercise, so an empty list means something is wrong.
    ['no exercises', { ...validTemplate, exercises: [] }],
    ['a set_count of 0', { ...validTemplate, exercises: [{ ...exercise, set_count: 0 }] }],
    ['a fractional set_count', { ...validTemplate, exercises: [{ ...exercise, set_count: 2.5 }] }],
    ['a missing exercise_name', { ...validTemplate, exercises: [{ ...exercise, exercise_name: undefined }] }],
  ])('rejects %s', (_label, value) => {
    expect(isTemplateDetail(value)).toBe(false);
  });

  it('rejects a single template where a list is expected', () => {
    expect(isTemplateDetailList(validTemplate)).toBe(false);
  });
});

describe('isExerciseLastSetsList', () => {
  const validLastSets = {
    exercise_id: 1,
    date: '2026-10-08',
    sets: [
      { reps: 5, weight: 225, unit: 'lb' },
      { reps: 3, weight: 102.5, unit: 'kg' },
    ],
  } satisfies ExerciseLastSets;

  it('accepts a list, including an empty one', () => {
    expect(isExerciseLastSetsList([validLastSets])).toBe(true);
    expect(isExerciseLastSetsList([])).toBe(true);
  });

  const set = validLastSets.sets[0];
  it.each([
    ['a single item (not a list)', validLastSets],
    ['a timestamp date', [{ ...validLastSets, date: '2026-10-08T00:00:00Z' }]],
    // Only sets with 1+ reps are sent, and an exercise without any is left out.
    ['no sets', [{ ...validLastSets, sets: [] }]],
    ['a set with 0 reps', [{ ...validLastSets, sets: [{ ...set, reps: 0 }] }]],
    ['a set with a string weight', [{ ...validLastSets, sets: [{ ...set, weight: '225' }] }]],
    ['a set with an unknown unit', [{ ...validLastSets, sets: [{ ...set, unit: 'st' }] }]],
  ])('rejects %s', (_label, value) => {
    expect(isExerciseLastSetsList(value)).toBe(false);
  });
});
