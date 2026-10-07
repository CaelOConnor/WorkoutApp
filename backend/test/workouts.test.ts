import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { addSet, createExercise, createUser, createWorkout, pool, resetDb } from './db';
import type {
  PublicUser,
  Workout,
  WorkoutDetail,
  WorkoutHistoryRow,
  WorkoutSet,
} from '../src/types/models';

// At the top level, afterAll runs once after every describe in this file. Inside a describe,
// it would close the pool when that block finished, before the next block's tests ran.
afterAll(async () => {
  await pool.end();
});

// Dates both routes must reject. Before strict validation, each one either reached Postgres and
// failed there (a 500), or was accepted by both JS and Postgres (a silent wrong 201/200).
const INVALID_DATES = [
  // Date.parse rolls these over to the next month; Postgres rejects them (500).
  '2026-02-29', // 2026 isn't a leap year
  '2026-02-30',
  '2026-04-31',
  '1900-02-29', // divisible by 100 but not 400, so not a leap year
  '0000-01-01', // JS has a year 0; Postgres (like the calendar) doesn't
  '+002026-10-07', // JS's extended-year format
  // Both accept these, so the wrong format was stored without complaint (201/200).
  '10/07/2026', // Postgres reads it month-first; a DD/MM client meant 10 July
  'October 7, 2026',
  '2026-10-07T12:00:00Z', // a timestamp, not a date
  '2026-1-7', // missing zero padding
  ' 2026-10-07', // leading space
];

// Real leap days, so a check that's too strict (e.g. rejecting every Feb 29) fails.
// 2000 is divisible by 400, so it's a leap year despite being a century.
const VALID_LEAP_DAYS = ['2024-02-29', '2000-02-29'];

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

  it('returns 400 and saves nothing when an exercise_id does not exist', async () => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({
        // The first set is valid, so by the time the second one fails the workout row and
        // set 1 are already inserted. Only a ROLLBACK leaves the tables empty.
        sets: [
          { exercise_id: exerciseId, set_number: 1, reps: 5, weight: 225 },
          { exercise_id: 9999, set_number: 2, reps: 5, weight: 225 },
        ],
      });

    expect(res.status).toBe(400);
    // expect.any(String) matches any string, so the test doesn't pin the exact wording.
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts');
    const sets = await pool.query('SELECT id FROM sets');
    expect(workouts.rows).toEqual([]);
    expect(sets.rows).toEqual([]);
  });

  // JSON.stringify in the title makes ' 2026-10-07' show its leading space in the output.
  it.each(INVALID_DATES)('returns 400 and saves nothing for date %j', async (date) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ date, sets: [{ exercise_id: exerciseId, set_number: 1, reps: 5, weight: 225 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts');
    expect(workouts.rows).toEqual([]);
  });

  it.each(VALID_LEAP_DAYS)('saves the leap day %s', async (date) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ date, sets: [{ exercise_id: exerciseId, set_number: 1, reps: 5, weight: 225 }] });

    expect(res.status).toBe(201);
    // date::text lets Postgres format the DATE, avoiding JS time-zone conversion.
    const saved = await pool.query<{ date: string }>('SELECT date::text AS date FROM workouts');
    expect(saved.rows).toEqual([{ date }]);
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

describe('GET /workouts/:id with a valid token', () => {
  let lifter: PublicUser;
  let squatId: number;
  let benchId: number;
  let workout: Pick<Workout, 'id'>;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
    benchId = (await createExercise('Bench')).id;
    // createWorkout adds set 1 (Squat, 5 reps, 100).
    workout = await createWorkout(lifter.id, squatId, 'Leg day');
  });

  it("returns the token user's workout with its sets nested, ordered by set_number", async () => {
    // Inserted out of order (3 before 2), so ordering by insertion or by id would fail the test.
    const set3 = await addSet(workout.id, benchId, 3, 8, 60);
    const set2 = await addSet(workout.id, squatId, 2, 3, 120.5);
    // createWorkout doesn't return its set's id, so look it up.
    const set1Result = await pool.query<Pick<WorkoutSet, 'id'>>(
      'SELECT id FROM sets WHERE workout_id = $1 AND set_number = 1',
      [workout.id]
    );
    const set1 = set1Result.rows[0];

    const res = await request(app)
      .get(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    // Annotated so the expected object is checked against the type: a typo in a key is a compile error.
    const expected: WorkoutDetail = {
      id: workout.id,
      // DATE goes through a JS Date and then JSON, so the exact string depends on the server's
      // time zone. Asserting only that it's a string keeps the test from depending on that.
      date: expect.any(String),
      notes: 'Leg day',
      sets: [
        // NUMERIC(6,2) comes back as a string, so weights are '100.00', not 100.
        { id: set1?.id ?? -1, exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: '100.00', unit: 'lb' },
        { id: set2.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 2, reps: 3, weight: '120.50', unit: 'lb' },
        { id: set3.id, exercise_id: benchId, exercise_name: 'Bench', set_number: 3, reps: 8, weight: '60.00', unit: 'lb' },
      ],
    };
    expect(res.body).toEqual(expected);
  });

  it("returns 404 for another user's workout", async () => {
    const intruder = await createUser('intruder@example.com', 'password');

    const res = await request(app)
      .get(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(intruder.id));

    // 404, not 403: a 403 would confirm the workout exists, which leaks information.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it("returns 404 for an id that doesn't exist", async () => {
    // resetDb restarts ids at 1 and only one workout exists, so 999999 is unused.
    const res = await request(app).get('/workouts/999999').set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  // Each value is a string Express would happily put in req.params.id.
  // '2147483648' is one past the largest Postgres INTEGER, to pin the exact boundary.
  it.each(['abc', '0', '-1', '1.5', '1e3', '99999999999', '2147483648'])(
    'returns 400 for id %s',
    async (id) => {
      const res = await request(app).get(`/workouts/${id}`).set('Authorization', authHeader(lifter.id));

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
  );

  // The other side of the boundary: the largest INTEGER is a valid id. No workout has it,
  // so 404 shows the id got past parseId and reached the query (and Postgres accepted it).
  it('accepts the largest Postgres integer as an id', async () => {
    const res = await request(app)
      .get('/workouts/2147483647')
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
  });
});

describe('PATCH /workouts/:id with a valid token', () => {
  let lifter: PublicUser;
  let squatId: number;
  let workout: Pick<Workout, 'id'>;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
    // createWorkout adds set 1 (Squat, 5 reps, 100).
    workout = await createWorkout(lifter.id, squatId, 'Leg day');
  });

  it('updates the notes, returns the updated workout, and saves it', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ notes: 'Heavy leg day' });

    expect(res.status).toBe(200);
    // Same shape as GET /workouts/:id, so a client can use either response the same way.
    const expected: WorkoutDetail = {
      id: workout.id,
      date: expect.any(String),
      notes: 'Heavy leg day',
      sets: [
        { id: expect.any(Number), exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: '100.00', unit: 'lb' },
      ],
    };
    expect(res.body).toEqual(expected);
    // The response alone could be built from the request body without writing anything,
    // so check the row too.
    const saved = await pool.query<Pick<Workout, 'notes'>>('SELECT notes FROM workouts WHERE id = $1', [workout.id]);
    expect(saved.rows).toEqual([{ notes: 'Heavy leg day' }]);
  });

  it('updates only the date when notes is missing, leaving notes unchanged', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ date: '2026-09-01' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: workout.id, notes: 'Leg day' });
    // date::text makes Postgres format the DATE itself ('YYYY-MM-DD'), so the check doesn't
    // depend on how a JS Date converts it in this machine's time zone.
    const saved = await pool.query<{ date: string; notes: string | null }>(
      'SELECT date::text AS date, notes FROM workouts WHERE id = $1',
      [workout.id]
    );
    expect(saved.rows).toEqual([{ date: '2026-09-01', notes: 'Leg day' }]);
  });

  // null is a real JSON value meaning "set to empty", unlike a missing key, which means "don't touch".
  it('clears the notes when notes is null', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ notes: null });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: workout.id, notes: null });
    const saved = await pool.query<Pick<Workout, 'notes'>>('SELECT notes FROM workouts WHERE id = $1', [workout.id]);
    expect(saved.rows).toEqual([{ notes: null }]);
  });

  it("returns 404 for another user's workout and leaves it unchanged", async () => {
    const intruder = await createUser('intruder@example.com', 'password');

    const res = await request(app)
      .patch(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(intruder.id))
      .send({ notes: 'hacked' });

    // Same 404 as a missing id, so the response doesn't confirm the workout exists.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    // The status alone isn't enough: a route could write first and 404 afterwards.
    const saved = await pool.query<Pick<Workout, 'notes'>>('SELECT notes FROM workouts WHERE id = $1', [workout.id]);
    expect(saved.rows).toEqual([{ notes: 'Leg day' }]);
  });

  // Same ids as the GET tests. The body is valid, so only the id can cause the 400.
  it.each(['abc', '0', '-1', '1.5', '1e3', '99999999999', '2147483648'])(
    'returns 400 for id %s',
    async (id) => {
      const res = await request(app)
        .patch(`/workouts/${id}`)
        .set('Authorization', authHeader(lifter.id))
        .send({ notes: 'x' });

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
  );

  it.each([
    // Nothing to change, which is almost certainly a client bug, so say so instead of a no-op 200.
    ['an empty object', {}],
    ['notes as a number', { notes: 5 }],
    ['an unparseable date', { date: 'not-a-date' }],
    // date is NOT NULL, so unlike notes it can't be cleared.
    ['a null date', { date: null }],
    // Unknown keys are rejected rather than ignored: a typo like `note` would otherwise be a
    // silent no-op, and fields like user_id must never look editable.
    ['an unknown field alongside a valid one', { notes: 'x', user_id: 2 }],
    ['sets, which have their own routes', { notes: 'x', sets: [] }],
  ])('returns 400 and changes nothing for %s', async (_label, body) => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const saved = await pool.query<Pick<Workout, 'notes'>>('SELECT notes FROM workouts WHERE id = $1', [workout.id]);
    expect(saved.rows).toEqual([{ notes: 'Leg day' }]);
  });

  it.each(INVALID_DATES)('returns 400 and leaves the date unchanged for date %j', async (date) => {
    // The workout's date is the column default (today), so read it rather than hard-code it.
    const before = await pool.query<{ date: string }>('SELECT date::text AS date FROM workouts WHERE id = $1', [workout.id]);

    const res = await request(app)
      .patch(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ date });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const after = await pool.query<{ date: string }>('SELECT date::text AS date FROM workouts WHERE id = $1', [workout.id]);
    expect(after.rows).toEqual(before.rows);
  });

  it.each(VALID_LEAP_DAYS)('updates the date to the leap day %s', async (date) => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ date });

    expect(res.status).toBe(200);
    const saved = await pool.query<{ date: string }>('SELECT date::text AS date FROM workouts WHERE id = $1', [workout.id]);
    expect(saved.rows).toEqual([{ date }]);
  });
});

describe('DELETE /workouts/:id with a valid token', () => {
  let lifter: PublicUser;
  let squatId: number;
  let workout: Pick<Workout, 'id'>;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
    // createWorkout adds set 1 (Squat, 5 reps, 100).
    workout = await createWorkout(lifter.id, squatId, 'Leg day');
  });

  it('deletes the workout and returns 204 with no body', async () => {
    const res = await request(app)
      .delete(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(204);
    // 204 No Content means the response has no body at all, so the raw text is empty.
    expect(res.text).toBe('');
    // Checked through the API rather than the table: the client-visible result is that it's gone.
    const after = await request(app)
      .get(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id));
    expect(after.status).toBe(404);
  });

  it("deletes the workout's sets too", async () => {
    await addSet(workout.id, squatId, 2, 3, 120);

    const res = await request(app)
      .delete(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(204);
    // No API route lists sets on their own, so check the table: orphaned sets would be invisible otherwise.
    const sets = await pool.query('SELECT id FROM sets WHERE workout_id = $1', [workout.id]);
    expect(sets.rows).toEqual([]);
  });

  it("returns 404 for an id that doesn't exist", async () => {
    // resetDb restarts ids at 1 and only one workout exists, so 999999 is unused.
    const res = await request(app).delete('/workouts/999999').set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('returns 404 when the same workout is deleted twice', async () => {
    const first = await request(app)
      .delete(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id));
    const second = await request(app)
      .delete(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(first.status).toBe(204);
    // The second call finds nothing to delete, so it reports that rather than a second success.
    expect(second.status).toBe(404);
    expect(second.body).toEqual({ error: expect.any(String) });
  });

  it("returns 404 for another user's workout and leaves it and its sets in place", async () => {
    const intruder = await createUser('intruder@example.com', 'password');

    const res = await request(app)
      .delete(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(intruder.id));

    // 404, not 403, so the intruder can't tell the workout exists.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts WHERE id = $1', [workout.id]);
    const sets = await pool.query('SELECT id FROM sets WHERE workout_id = $1', [workout.id]);
    expect(workouts.rows).toHaveLength(1);
    expect(sets.rows).toHaveLength(1);
  });

  it.each(['abc', '0', '-1', '1.5', '1e3', '99999999999', '2147483648'])(
    'returns 400 for id %s',
    async (id) => {
      const res = await request(app).delete(`/workouts/${id}`).set('Authorization', authHeader(lifter.id));

      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: expect.any(String) });
    }
  );
});
