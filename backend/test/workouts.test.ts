import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { addSet, createExercise, createUser, createWorkout, pool, resetDb } from './db';
import type {
  PublicUser,
  Workout,
  WorkoutDetail,
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

// sets.weight is NUMERIC(6,2): 6 digits in total, 2 after the point, so the largest is 9999.99.
// Each of these either overflows the column (a 500) or would be silently rounded to 2 places.
const INVALID_WEIGHTS = [
  10000, // one cent past the max
  9999.999, // rounds up to 10000.00, which then overflows
  100.125, // Postgres would quietly store 100.13
  0.001, // would be stored as 0.00
];

// The other side of each boundary, with what Postgres should store for it.
const VALID_WEIGHTS: [weight: number, stored: string][] = [
  [9999.99, '9999.99'],
  [100.12, '100.12'],
  [0.01, '0.01'],
];

// Largest value a Postgres INTEGER holds; reps, set_number and exercise_id are all INTEGER.
const MAX_PG_INTEGER = 2_147_483_647;

// Integer set fields one past that limit. Postgres rejects them with an out-of-range error (a 500).
const OVERSIZED_INTEGER_FIELDS = [
  ['reps', { reps: MAX_PG_INTEGER + 1 }],
  ['set_number', { set_number: MAX_PG_INTEGER + 1 }],
  ['exercise_id', { exercise_id: MAX_PG_INTEGER + 1 }],
] as const;

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

  it.each(INVALID_WEIGHTS)('returns 400 and saves nothing for weight %s', async (weight) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, set_number: 1, reps: 5, weight }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts');
    expect(workouts.rows).toEqual([]);
  });

  it.each(VALID_WEIGHTS)('saves weight %s exactly', async (weight, stored) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, set_number: 1, reps: 5, weight }] });

    expect(res.status).toBe(201);
    const saved = await pool.query<Pick<WorkoutSet, 'weight'>>('SELECT weight FROM sets');
    expect(saved.rows).toEqual([{ weight: stored }]);
  });

  it.each(OVERSIZED_INTEGER_FIELDS)('returns 400 and saves nothing for %s past the INTEGER max', async (_label, field) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      // Spread order matters: the oversized field comes last, so it overrides the valid one.
      .send({ sets: [{ exercise_id: exerciseId, set_number: 1, reps: 5, weight: 100, ...field }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts');
    expect(workouts.rows).toEqual([]);
  });

  it('saves the largest INTEGER as reps and set_number', async () => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, set_number: MAX_PG_INTEGER, reps: MAX_PG_INTEGER, weight: 100 }] });

    expect(res.status).toBe(201);
    const saved = await pool.query<Pick<WorkoutSet, 'reps' | 'set_number'>>('SELECT reps, set_number FROM sets');
    expect(saved.rows).toEqual([{ reps: MAX_PG_INTEGER, set_number: MAX_PG_INTEGER }]);
  });
});

// Sets a workout's date directly, so ordering tests control it instead of getting today's default.
async function setWorkoutDate(workoutId: number, date: string): Promise<void> {
  await pool.query('UPDATE workouts SET date = $1 WHERE id = $2', [date, workoutId]);
}

describe('GET /workouts with a valid token', () => {
  let userA: PublicUser;
  let userB: PublicUser;
  let benchId: number;
  let squatId: number;
  let workoutA: Pick<Workout, 'id'>;

  beforeEach(async () => {
    await resetDb();
    userA = await createUser('a@example.com', 'password');
    userB = await createUser('b@example.com', 'password');
    benchId = (await createExercise('Bench')).id;
    squatId = (await createExercise('Squat')).id;
    // createWorkout adds set 1 (5 reps, 100) of the given exercise.
    workoutA = await createWorkout(userA.id, benchId, "A's workout");
    await createWorkout(userB.id, benchId, "B's workout");
  });

  it("returns only the token user's workouts, in the same shape as GET /workouts/:id", async () => {
    const res = await request(app).get('/workouts').set('Authorization', authHeader(userA.id));

    expect(res.status).toBe(200);
    // Annotating with the type makes a typo or a missing key in `expected` a compile error.
    const expected: WorkoutDetail[] = [
      {
        id: workoutA.id,
        date: expect.any(String),
        notes: "A's workout",
        sets: [
          { id: expect.any(Number), exercise_id: benchId, exercise_name: 'Bench', set_number: 1, reps: 5, weight: '100.00', unit: 'lb' },
        ],
      },
    ];
    expect(res.body).toEqual(expected);
  });

  it('nests each workout\'s own sets under it, ordered by set_number', async () => {
    const workoutA2 = await createWorkout(userA.id, squatId, 'Leg day');
    await setWorkoutDate(workoutA.id, '2026-09-02');
    await setWorkoutDate(workoutA2.id, '2026-09-01');
    // Inserted out of order and interleaved across the two workouts, so grouping or ordering
    // by insertion (set id) would put sets in the wrong place.
    const a3 = await addSet(workoutA.id, benchId, 3, 6, 80);
    const b2 = await addSet(workoutA2.id, squatId, 2, 3, 140);
    const a2 = await addSet(workoutA.id, squatId, 2, 8, 60);

    const res = await request(app).get('/workouts').set('Authorization', authHeader(userA.id));

    expect(res.status).toBe(200);
    const expected: WorkoutDetail[] = [
      {
        id: workoutA.id,
        date: expect.any(String),
        notes: "A's workout",
        sets: [
          { id: expect.any(Number), exercise_id: benchId, exercise_name: 'Bench', set_number: 1, reps: 5, weight: '100.00', unit: 'lb' },
          { id: a2.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 2, reps: 8, weight: '60.00', unit: 'lb' },
          { id: a3.id, exercise_id: benchId, exercise_name: 'Bench', set_number: 3, reps: 6, weight: '80.00', unit: 'lb' },
        ],
      },
      {
        id: workoutA2.id,
        date: expect.any(String),
        notes: 'Leg day',
        sets: [
          { id: expect.any(Number), exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: '100.00', unit: 'lb' },
          { id: b2.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 2, reps: 3, weight: '140.00', unit: 'lb' },
        ],
      },
    ];
    expect(res.body).toEqual(expected);
  });

  it('orders workouts newest date first, then by id descending within a date', async () => {
    // The highest id gets the oldest date, so ordering by id alone fails, and the two on the
    // same date catch a missing (or ascending) id tiebreaker.
    const sameDayLater = await createWorkout(userA.id, benchId, 'same day, later id');
    const oldest = await createWorkout(userA.id, benchId, 'oldest');
    await setWorkoutDate(workoutA.id, '2026-09-03');
    await setWorkoutDate(sameDayLater.id, '2026-09-03');
    await setWorkoutDate(oldest.id, '2026-09-01');

    const res = await request(app).get('/workouts').set('Authorization', authHeader(userA.id));

    expect(res.status).toBe(200);
    const workouts: WorkoutDetail[] = res.body;
    expect(workouts.map((w) => w.id)).toEqual([sameDayLater.id, workoutA.id, oldest.id]);
  });

  it('returns a workout with no sets once, with sets: []', async () => {
    // Inserted directly: createWorkout always adds a set.
    const emptyResult = await pool.query<Pick<Workout, 'id'>>(
      "INSERT INTO workouts (user_id, date, notes) VALUES ($1, '2026-09-05', 'Rest day') RETURNING id",
      [userA.id]
    );
    const emptyId = emptyResult.rows[0]?.id ?? -1;
    await setWorkoutDate(workoutA.id, '2026-09-01');

    const res = await request(app).get('/workouts').set('Authorization', authHeader(userA.id));

    expect(res.status).toBe(200);
    const workouts: WorkoutDetail[] = res.body;
    // filter, not find: a duplicate entry for the empty workout should fail the test too.
    expect(workouts.filter((w) => w.id === emptyId)).toEqual([
      { id: emptyId, date: expect.any(String), notes: 'Rest day', sets: [] },
    ]);
    expect(workouts).toHaveLength(2);
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

// Ids every :id/:setId route must reject with 400 (see the GET /workouts/:id tests for why each).
const INVALID_IDS = ['abc', '0', '-1', '1.5', '1e3', '99999999999', '2147483648'];

// One set's stored columns, read straight from the table so tests can check whether a write
// happened, independently of what the route returned. Omit<T, K> is Pick's opposite: every
// field of T except K.
async function readSet(setId: number): Promise<Omit<WorkoutSet, 'id'> | undefined> {
  const result = await pool.query<Omit<WorkoutSet, 'id'>>(
    'SELECT workout_id, exercise_id, set_number, reps, weight, unit FROM sets WHERE id = $1',
    [setId]
  );
  return result.rows[0];
}

describe('PATCH /workouts/:id/sets/:setId with a valid token', () => {
  let lifter: PublicUser;
  let intruder: PublicUser;
  let squatId: number;
  let benchId: number;
  let workout: Pick<Workout, 'id'>;
  let otherWorkout: Pick<Workout, 'id'>;
  let intruderWorkout: Pick<Workout, 'id'>;
  let set: Pick<WorkoutSet, 'id'>;
  // The target set's row before each test, for "changes nothing" checks.
  let original: Omit<WorkoutSet, 'id'> | undefined;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    intruder = await createUser('intruder@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
    benchId = (await createExercise('Bench')).id;
    // createWorkout adds set 1 (Squat, 5 reps, 100); the set under test is set 2.
    workout = await createWorkout(lifter.id, squatId, 'Leg day');
    set = await addSet(workout.id, squatId, 2, 3, 120);
    otherWorkout = await createWorkout(lifter.id, squatId, 'Another day');
    intruderWorkout = await createWorkout(intruder.id, squatId, 'Intruder day');
    original = await readSet(set.id);
  });

  it('updates reps and weight, returns the parent workout, and saves the change', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ reps: 4, weight: 125.5 });

    expect(res.status).toBe(200);
    // The whole workout comes back, not just the set, so a client can redraw the screen from it.
    const expected: WorkoutDetail = {
      id: workout.id,
      date: expect.any(String),
      notes: 'Leg day',
      sets: [
        { id: expect.any(Number), exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: '100.00', unit: 'lb' },
        { id: set.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 2, reps: 4, weight: '125.50', unit: 'lb' },
      ],
    };
    expect(res.body).toEqual(expected);
    expect(await readSet(set.id)).toEqual({ ...original, reps: 4, weight: '125.50' });
  });

  it('changes the exercise, and the response shows the new exercise name', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: benchId });

    expect(res.status).toBe(200);
    const body: WorkoutDetail = res.body;
    // find() returns `WorkoutDetailSet | undefined`; toMatchObject fails on undefined, which is what we want.
    expect(body.sets.find((s) => s.id === set.id)).toMatchObject({ exercise_id: benchId, exercise_name: 'Bench' });
  });

  it('updates set_number and unit, leaving the other columns unchanged', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ set_number: 7, unit: 'kg' });

    expect(res.status).toBe(200);
    expect(await readSet(set.id)).toEqual({ ...original, set_number: 7, unit: 'kg' });
  });

  it('returns 400 and changes nothing for an exercise_id that does not exist', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: 9999, reps: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    // reps was valid, but the UPDATE is one statement, so the FK failure stops all of it.
    expect(await readSet(set.id)).toEqual(original);
  });

  // The 404 cases below all give the same response, so a caller can't tell which rule failed,
  // and each one leaves the set as it was.
  it("returns 404 when another user sends the set id under their own workout's id", async () => {
    const res = await request(app)
      .patch(`/workouts/${intruderWorkout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(intruder.id))
      .send({ reps: 99 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toEqual(original);
  });

  it("returns 404 when another user sends the set under its real workout's id", async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(intruder.id))
      .send({ reps: 99 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toEqual(original);
  });

  it('returns 404 when the owner sends the set under a different one of their workouts', async () => {
    const res = await request(app)
      .patch(`/workouts/${otherWorkout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ reps: 99 });

    // Owning both workouts isn't enough: the URL claims the set is in otherWorkout, and it isn't.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toEqual(original);
  });

  it("returns 404 for a set id that doesn't exist", async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/999999`)
      .set('Authorization', authHeader(lifter.id))
      .send({ reps: 99 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each(INVALID_IDS)('returns 400 for workout id %s', async (id) => {
    const res = await request(app)
      .patch(`/workouts/${id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ reps: 99 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each(INVALID_IDS)('returns 400 for set id %s', async (id) => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ reps: 99 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each([
    ['an empty object', {}],
    ['an unknown field alongside a valid one', { reps: 4, rpe: 8 }],
    // Moving a set between workouts isn't this route's job; the URL decides the workout.
    ['workout_id', { workout_id: 2 }],
    ['id', { id: 5 }],
    // Every set column is NOT NULL, so null is never a valid value here.
    ['a null reps', { reps: null }],
    ['negative reps', { reps: -1 }],
    ['fractional reps', { reps: 2.5 }],
    ['reps as a string', { reps: '5' }],
    ['negative weight', { weight: -5 }],
    ['weight as a string', { weight: '100' }],
    ['set_number 0', { set_number: 0 }],
    ['exercise_id 0', { exercise_id: 0 }],
    ['an unknown unit', { unit: 'stone' }],
    ['a null unit', { unit: null }],
  ])('returns 400 and changes nothing for %s', async (_label, body) => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toEqual(original);
  });

  it.each(INVALID_WEIGHTS)('returns 400 and changes nothing for weight %s', async (weight) => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ weight });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toEqual(original);
  });

  it.each(VALID_WEIGHTS)('saves weight %s exactly', async (weight, stored) => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ weight });

    expect(res.status).toBe(200);
    expect(await readSet(set.id)).toEqual({ ...original, weight: stored });
  });

  it.each(OVERSIZED_INTEGER_FIELDS)('returns 400 and changes nothing for %s past the INTEGER max', async (_label, body) => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toEqual(original);
  });

  it('saves the largest INTEGER as reps and set_number', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ reps: MAX_PG_INTEGER, set_number: MAX_PG_INTEGER });

    expect(res.status).toBe(200);
    expect(await readSet(set.id)).toEqual({ ...original, reps: MAX_PG_INTEGER, set_number: MAX_PG_INTEGER });
  });
});

describe('DELETE /workouts/:id/sets/:setId with a valid token', () => {
  let lifter: PublicUser;
  let intruder: PublicUser;
  let squatId: number;
  let workout: Pick<Workout, 'id'>;
  let otherWorkout: Pick<Workout, 'id'>;
  let intruderWorkout: Pick<Workout, 'id'>;
  let set: Pick<WorkoutSet, 'id'>;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    intruder = await createUser('intruder@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
    // createWorkout adds set 1 (Squat, 5 reps, 100); the set under test is set 2.
    workout = await createWorkout(lifter.id, squatId, 'Leg day');
    set = await addSet(workout.id, squatId, 2, 3, 120);
    otherWorkout = await createWorkout(lifter.id, squatId, 'Another day');
    intruderWorkout = await createWorkout(intruder.id, squatId, 'Intruder day');
  });

  it('deletes only that set and returns 204 with no body', async () => {
    const res = await request(app)
      .delete(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(204);
    expect(res.text).toBe('');
    // Through the API: the workout is still there, with set 1 and without set 2.
    const after = await request(app)
      .get(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id));
    const detail: WorkoutDetail = after.body;
    expect(detail.sets.map((s) => s.set_number)).toEqual([1]);
  });

  it("keeps a workout in both GET routes after its last set is deleted", async () => {
    // otherWorkout has only the one set createWorkout gave it.
    const onlySet = await pool.query<Pick<WorkoutSet, 'id'>>('SELECT id FROM sets WHERE workout_id = $1', [
      otherWorkout.id,
    ]);
    const onlySetId = onlySet.rows[0]?.id ?? -1;

    const res = await request(app)
      .delete(`/workouts/${otherWorkout.id}/sets/${onlySetId}`)
      .set('Authorization', authHeader(lifter.id));
    expect(res.status).toBe(204);

    const detail = await request(app)
      .get(`/workouts/${otherWorkout.id}`)
      .set('Authorization', authHeader(lifter.id));
    expect(detail.body).toMatchObject({ id: otherWorkout.id, notes: 'Another day', sets: [] });

    // The list still includes the emptied workout, with sets: [], so the client can show it
    // (e.g. "Another day: no sets yet").
    const history = await request(app).get('/workouts').set('Authorization', authHeader(lifter.id));
    const workouts: WorkoutDetail[] = history.body;
    expect(workouts.filter((w) => w.id === otherWorkout.id)).toEqual([
      { id: otherWorkout.id, date: expect.any(String), notes: 'Another day', sets: [] },
    ]);
  });

  it('returns 404 when the same set is deleted twice', async () => {
    const first = await request(app)
      .delete(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id));
    const second = await request(app)
      .delete(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(first.status).toBe(204);
    expect(second.status).toBe(404);
    expect(second.body).toEqual({ error: expect.any(String) });
  });

  it("returns 404 when another user sends the set id under their own workout's id", async () => {
    const res = await request(app)
      .delete(`/workouts/${intruderWorkout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(intruder.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toBeDefined();
  });

  it("returns 404 when another user sends the set under its real workout's id", async () => {
    const res = await request(app)
      .delete(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(intruder.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toBeDefined();
  });

  it('returns 404 when the owner sends the set under a different one of their workouts', async () => {
    const res = await request(app)
      .delete(`/workouts/${otherWorkout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toBeDefined();
  });

  it("returns 404 for a set id that doesn't exist", async () => {
    const res = await request(app)
      .delete(`/workouts/${workout.id}/sets/999999`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each(INVALID_IDS)('returns 400 for workout id %s', async (id) => {
    const res = await request(app)
      .delete(`/workouts/${id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each(INVALID_IDS)('returns 400 for set id %s', async (id) => {
    const res = await request(app)
      .delete(`/workouts/${workout.id}/sets/${id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

// A workout's set ids straight from the table, for "saves nothing" checks.
async function setIdsOf(workoutId: number): Promise<number[]> {
  const result = await pool.query<Pick<WorkoutSet, 'id'>>('SELECT id FROM sets WHERE workout_id = $1 ORDER BY id', [
    workoutId,
  ]);
  return result.rows.map((row) => row.id);
}

describe('POST /workouts/:id/sets with a valid token', () => {
  let lifter: PublicUser;
  let intruder: PublicUser;
  let squatId: number;
  let benchId: number;
  let workout: Pick<Workout, 'id'>;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    intruder = await createUser('intruder@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
    benchId = (await createExercise('Bench')).id;
    // createWorkout adds set 1 (Squat, 5 reps, 100).
    workout = await createWorkout(lifter.id, squatId, 'Leg day');
  });

  it('adds a set with the given set_number and returns 201 with the whole workout', async () => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: benchId, set_number: 5, reps: 8, weight: 60.5, unit: 'kg' });

    expect(res.status).toBe(201);
    const expected: WorkoutDetail = {
      id: workout.id,
      date: expect.any(String),
      notes: 'Leg day',
      sets: [
        { id: expect.any(Number), exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: '100.00', unit: 'lb' },
        { id: expect.any(Number), exercise_id: benchId, exercise_name: 'Bench', set_number: 5, reps: 8, weight: '60.50', unit: 'kg' },
      ],
    };
    expect(res.body).toEqual(expected);
    // The response is read back from the table, but count the rows too, so a route that
    // inserted twice would fail.
    expect(await setIdsOf(workout.id)).toHaveLength(2);
  });

  it('assigns the highest set_number + 1 when set_number is missing, past any gap', async () => {
    // Sets 1 and 3, as if set 2 had been deleted. Counting sets would give 3, a duplicate.
    await addSet(workout.id, squatId, 3, 3, 120);

    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 2, weight: 130 });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    expect(body.sets.map((s) => s.set_number)).toEqual([1, 3, 4]);
    // unit was missing too, so it gets the column's default.
    expect(body.sets[2]).toMatchObject({ exercise_id: squatId, set_number: 4, reps: 2, weight: '130.00', unit: 'lb' });
  });

  it("only counts this workout's sets when assigning set_number", async () => {
    // A higher set_number in another of the user's workouts must not leak into this one.
    const other = await createWorkout(lifter.id, squatId, 'Another day');
    await addSet(other.id, squatId, 9, 5, 100);

    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 5, weight: 100 });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    expect(body.sets.map((s) => s.set_number)).toEqual([1, 2]);
  });

  it('adds set 1 to a workout whose sets were all deleted', async () => {
    const [onlySetId] = await setIdsOf(workout.id);
    const deleted = await request(app)
      .delete(`/workouts/${workout.id}/sets/${onlySetId ?? -1}`)
      .set('Authorization', authHeader(lifter.id));
    expect(deleted.status).toBe(204);

    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: benchId, reps: 10, weight: 40 });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    expect(body.sets).toEqual([
      { id: expect.any(Number), exercise_id: benchId, exercise_name: 'Bench', set_number: 1, reps: 10, weight: '40.00', unit: 'lb' },
    ]);
  });

  it('returns 409 and saves nothing when the next set_number would pass the INTEGER max', async () => {
    // Reachable through the API: PATCH a set's set_number to the max, then add one without a number.
    await addSet(workout.id, squatId, MAX_PG_INTEGER, 5, 100);
    const before = await setIdsOf(workout.id);

    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 5, weight: 100 });

    // 409 Conflict, not 400: the body is fine; the workout's current state is what blocks it.
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await setIdsOf(workout.id)).toEqual(before);
  });

  it('returns 400 and saves nothing for an exercise_id that does not exist', async () => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: 9999, reps: 5, weight: 100 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await setIdsOf(workout.id)).toHaveLength(1);
  });

  // The 404s below give the same response, so a caller can't tell whether the workout exists.
  it("returns 404 and saves nothing for another user's workout", async () => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(intruder.id))
      .send({ exercise_id: squatId, reps: 5, weight: 100 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await setIdsOf(workout.id)).toHaveLength(1);
  });

  it("returns 404, not 400, for another user's workout even with an unknown exercise_id", async () => {
    // A 400 here would mean the route got as far as trying the insert, i.e. the workout exists.
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(intruder.id))
      .send({ exercise_id: 9999, reps: 5, weight: 100 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it("returns 404 for a workout id that doesn't exist", async () => {
    const res = await request(app)
      .post('/workouts/999999/sets')
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 5, weight: 100 });

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each(INVALID_IDS)('returns 400 for workout id %s', async (id) => {
    const res = await request(app)
      .post(`/workouts/${id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 5, weight: 100 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  // exercise_id 1 is Squat (resetDb restarts ids), so only the named problem makes each body invalid.
  // The row type is spelled out because the rows come from different places (literals and the
  // spread .map() results), and TypeScript would otherwise infer a loose array instead of pairs.
  type BodyCase = [label: string, body: Record<string, unknown>];
  const invalidBodies: BodyCase[] = [
    ['an empty object', {}],
    ['a missing exercise_id', { reps: 5, weight: 100 }],
    ['missing reps', { exercise_id: 1, weight: 100 }],
    ['a missing weight', { exercise_id: 1, reps: 5 }],
    // Optional means missing or valid; null is neither.
    ['a null set_number', { exercise_id: 1, reps: 5, weight: 100, set_number: null }],
    ['set_number 0', { exercise_id: 1, reps: 5, weight: 100, set_number: 0 }],
    ['an unknown unit', { exercise_id: 1, reps: 5, weight: 100, unit: 'stone' }],
    // Unknown keys are rejected, as in the PATCH routes: the URL decides the workout.
    ['workout_id', { exercise_id: 1, reps: 5, weight: 100, workout_id: 2 }],
    ['an unknown field', { exercise_id: 1, reps: 5, weight: 100, rpe: 8 }],
    ...INVALID_WEIGHTS.map((weight): BodyCase => [`weight ${weight}`, { exercise_id: 1, reps: 5, weight }]),
    ...OVERSIZED_INTEGER_FIELDS.map(
      ([label, field]): BodyCase => [`${label} past the INTEGER max`, { exercise_id: 1, reps: 5, weight: 100, ...field }]
    ),
  ];
  it.each(invalidBodies)('returns 400 and saves nothing for %s', async (_label, body) => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await setIdsOf(workout.id)).toHaveLength(1);
  });

  it.each(VALID_WEIGHTS)('saves weight %s exactly', async (weight, stored) => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 5, weight });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    expect(body.sets[1]?.weight).toBe(stored);
  });

  it('accepts the largest INTEGER as an explicit set_number and reps', async () => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, set_number: MAX_PG_INTEGER, reps: MAX_PG_INTEGER, weight: 100 });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    expect(body.sets[1]).toMatchObject({ set_number: MAX_PG_INTEGER, reps: MAX_PG_INTEGER });
  });
});
