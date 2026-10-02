import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { createExercise, createUser, pool, resetDb } from './db';
import type { PublicUser, Workout } from '../src/types/models';

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

  afterAll(async () => {
    await pool.end();
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
