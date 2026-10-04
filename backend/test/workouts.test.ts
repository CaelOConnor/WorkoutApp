import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { createExercise, createUser, createWorkout, pool, resetDb } from './db';
import type { PublicUser, Workout, WorkoutHistoryRow } from '../src/types/models';

// At the top level, afterAll runs once after every describe in this file. Inside a describe,
// it would close the pool when that block finished, before the next block's tests ran.
afterAll(async () => {
  await pool.end();
});

describe('POST /workouts with a valid token', () => {
  // `let` with a type annotation: assigned in beforeEach, read in the tests.
  let lifter: PublicUser;
  let exerciseId: number;

  beforeEach(async () => {
    await resetDb();
    // Create a decoy user first so the lifter gets id 2. If the route still hard-codes
    // user 1, the insert succeeds (user 1 exists) and the test fails on the user_id,
    // instead of on a foreign-key error that would hide the real bug.
    await createUser('decoy@example.com', 'password');
    lifter = await createUser('lifter@example.com', 'password');
    exerciseId = (await createExercise('Squat')).id;
  });

  it('saves the workout for the user in the token', async () => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, set_number: 1, reps: 5, weight: 225 }] });

    expect(res.status).toBe(201);
    // Check the database directly: the response only has the new id, not who owns it.
    const result = await pool.query<Pick<Workout, 'user_id'>>('SELECT user_id FROM workouts');
    expect(result.rows).toEqual([{ user_id: lifter.id }]);
  });
});

describe('GET /workouts with a valid token', () => {
  let userA: PublicUser;
  let userB: PublicUser;
  let workoutA: Pick<Workout, 'id'>;

  beforeEach(async () => {
    await resetDb();
    userA = await createUser('a@example.com', 'password');
    userB = await createUser('b@example.com', 'password');
    const exerciseId = (await createExercise('Bench')).id;
    workoutA = await createWorkout(userA.id, exerciseId, "A's workout");
    await createWorkout(userB.id, exerciseId, "B's workout");
  });

  it("returns only the token user's workouts", async () => {
    const res = await request(app).get('/workouts').set('Authorization', authHeader(userA.id));

    expect(res.status).toBe(200);
    // supertest's res.body is `any`; annotating it as WorkoutHistoryRow[] lets the
    // callback below be type-checked instead of silently accepting anything.
    const rows: WorkoutHistoryRow[] = res.body;
    expect(rows.map((row) => ({ id: row.id, notes: row.notes }))).toEqual([
      { id: workoutA.id, notes: "A's workout" },
    ]);
  });
});
