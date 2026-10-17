import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { addSet, createExercise, createUser, createWorkoutOn, pool, resetDb } from './db';
import type { ExerciseLastSets, PublicUser, WeightUnit } from '../src/types/models';

afterAll(async () => {
  await pool.end();
});

// One set as [exercise id, reps, weight, unit?].
type SetSpec = [exerciseId: number, reps: number, weight: number, unit?: WeightUnit];

// Logs one workout on `date` with the given sets, numbering each exercise's sets 1..n in order.
async function logWorkout(userId: number, date: string, sets: SetSpec[]): Promise<number> {
  const workout = await createWorkoutOn(userId, date);
  const counts = new Map<number, number>();
  for (const [exerciseId, reps, weight, unit] of sets) {
    const setNumber = (counts.get(exerciseId) ?? 0) + 1;
    counts.set(exerciseId, setNumber);
    await addSet(workout.id, exerciseId, setNumber, reps, weight, unit);
  }
  return workout.id;
}

let lifter: PublicUser;
let other: PublicUser;
let squat: number;
let bench: number;
let row: number;

beforeEach(async () => {
  await resetDb();
  lifter = await createUser('lifter@example.com', 'password');
  other = await createUser('other@example.com', 'password');
  squat = (await createExercise('Squat')).id;
  bench = (await createExercise('Bench Press')).id;
  row = (await createExercise('Row')).id;
});

// A string, not an array, so tests can send malformed query strings as they are.
function getLastSets(query: string, userId = lifter.id) {
  return request(app).get(`/exercises/last-sets?${query}`).set('Authorization', authHeader(userId));
}

describe('GET /exercises/last-sets', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get(`/exercises/last-sets?ids=${squat}`);

    expect(res.status).toBe(401);
  });

  it("returns each exercise's sets from the most recent workout that has it, in the order the ids were sent", async () => {
    await logWorkout(lifter.id, '2026-10-01', [
      [squat, 5, 185],
      [bench, 8, 135],
    ]);
    // Squat is newer here; Bench isn't in this workout, so its last time is still Oct 1.
    // Interleaved, to check each exercise's sets come back by set_number.
    await logWorkout(lifter.id, '2026-10-08', [
      [squat, 5, 225],
      [row, 10, 95],
      [squat, 3, 245.5],
    ]);

    const res = await getLastSets(`ids=${bench},${squat},${row}`);

    expect(res.status).toBe(200);
    const expected: ExerciseLastSets[] = [
      { exercise_id: bench, date: '2026-10-01', sets: [{ reps: 8, weight: 135, unit: 'lb' }] },
      {
        exercise_id: squat,
        date: '2026-10-08',
        sets: [
          { reps: 5, weight: 225, unit: 'lb' },
          { reps: 3, weight: 245.5, unit: 'lb' },
        ],
      },
      { exercise_id: row, date: '2026-10-08', sets: [{ reps: 10, weight: 95, unit: 'lb' }] },
    ];
    expect(res.body).toEqual(expected);
  });

  it('leaves out exercises never logged, and returns [] when none were', async () => {
    await logWorkout(lifter.id, '2026-10-01', [[squat, 5, 185]]);

    const some = await getLastSets(`ids=${bench},${squat}`);
    const none = await getLastSets(`ids=${bench},${row}`);

    expect(some.body.map((e: ExerciseLastSets) => e.exercise_id)).toEqual([squat]);
    expect(none.status).toBe(200);
    expect(none.body).toEqual([]);
  });

  it('picks the latest date, not the workout logged last', async () => {
    await logWorkout(lifter.id, '2026-10-08', [[squat, 5, 225]]);
    // Logged afterwards (a higher id), but for an earlier day.
    await logWorkout(lifter.id, '2026-10-01', [[squat, 5, 185]]);

    const res = await getLastSets(`ids=${squat}`);

    expect(res.body[0].sets).toEqual([{ reps: 5, weight: 225, unit: 'lb' }]);
  });

  it('picks the workout logged last when two are on the same day', async () => {
    await logWorkout(lifter.id, '2026-10-08', [[squat, 5, 185]]);
    await logWorkout(lifter.id, '2026-10-08', [[squat, 5, 225]]);

    const res = await getLastSets(`ids=${squat}`);

    expect(res.body[0].sets).toEqual([{ reps: 5, weight: 225, unit: 'lb' }]);
  });

  it('skips 0-rep sets, and a workout with only 0-rep sets of the exercise', async () => {
    await logWorkout(lifter.id, '2026-10-01', [
      [squat, 5, 185],
      [squat, 0, 205], // a failed attempt
      [squat, 5, 185],
    ]);
    // Newer, but only the app's 0 × 0 placeholder: not a real "last time".
    await logWorkout(lifter.id, '2026-10-08', [[squat, 0, 0]]);

    const res = await getLastSets(`ids=${squat}`);

    expect(res.body).toEqual([
      {
        exercise_id: squat,
        date: '2026-10-01',
        sets: [
          { reps: 5, weight: 185, unit: 'lb' },
          { reps: 5, weight: 185, unit: 'lb' },
        ],
      },
    ]);
  });

  it("keeps each set's own unit", async () => {
    await logWorkout(lifter.id, '2026-10-01', [
      [squat, 5, 100, 'kg'],
      [squat, 5, 225, 'lb'],
    ]);

    const res = await getLastSets(`ids=${squat}`);

    expect(res.body[0].sets).toEqual([
      { reps: 5, weight: 100, unit: 'kg' },
      { reps: 5, weight: 225, unit: 'lb' },
    ]);
  });

  it("never counts another user's sets", async () => {
    await logWorkout(lifter.id, '2026-10-01', [[squat, 5, 185]]);
    await logWorkout(other.id, '2026-10-08', [[squat, 1, 405]]);
    const theirs = (await createExercise('Their Lunge', other.id)).id;
    await logWorkout(other.id, '2026-10-08', [[theirs, 8, 50]]);

    const res = await getLastSets(`ids=${squat},${theirs}`);

    // Their custom exercise comes back the same as one never logged: no name, no sets.
    expect(res.body).toEqual([
      { exercise_id: squat, date: '2026-10-01', sets: [{ reps: 5, weight: 185, unit: 'lb' }] },
    ]);
  });

  it('returns a repeated id once', async () => {
    await logWorkout(lifter.id, '2026-10-01', [[squat, 5, 185]]);

    const res = await getLastSets(`ids=${squat},${squat}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('accepts 100 ids', async () => {
    const ids = Array.from({ length: 100 }, (_, i) => i + 1).join(',');

    const res = await getLastSets(`ids=${ids}`);

    expect(res.status).toBe(200);
  });

  it.each([
    ['no ids', ''],
    ['an empty ids', 'ids='],
    ['a non-numeric id', 'ids=1,abc'],
    ['an empty item', 'ids=1,,2'],
    ['a trailing comma', 'ids=1,'],
    ['an id of 0', 'ids=0'],
    ['a fractional id', 'ids=1.5'],
    ['spaces', 'ids=1,%202'],
    ['ids repeated as a key', 'ids=1&ids=2'],
    ['an unknown key', 'ids=1&unit=kg'],
    ['101 ids', `ids=${Array.from({ length: 101 }, (_, i) => i + 1).join(',')}`],
  ])('returns 400 for %s', async (_label, query) => {
    const res = await getLastSets(query);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid last-sets query' });
  });
});
