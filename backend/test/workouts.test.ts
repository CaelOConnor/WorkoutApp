import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { addSet, createExercise, createUser, createWorkout, createWorkoutOn, pool, resetDb } from './db';
import type {
  PublicUser,
  Workout,
  WorkoutDetail,
  WorkoutSet,
} from '../src/types/models';

// At the top level so it runs once after every describe. Inside one, it would close the pool
// before the next block's tests ran.
afterAll(async () => {
  await pool.end();
});

// Dates both routes must reject before they reach Postgres.
const INVALID_DATES = [
  // Date.parse rolls these over to the next month; Postgres rejects them (500).
  '2026-02-29', // 2026 isn't a leap year
  '2026-02-30',
  '2026-04-31',
  '1900-02-29', // divisible by 100 but not 400, so not a leap year
  '0000-01-01', // JS has a year 0; Postgres (like the calendar) doesn't
  '+002026-10-07', // JS's extended-year format
  // JS and Postgres both accept these, so without the check they'd be stored wrongly.
  '10/07/2026', // Postgres reads it month-first; a DD/MM client meant 10 July
  'October 7, 2026',
  '2026-10-07T12:00:00Z', // a timestamp, not a date
  '2026-1-7', // missing zero padding
  ' 2026-10-07', // leading space
];

// A plain 'YYYY-MM-DD' day, never a timestamp whose day depends on the server's time zone.
// For dates the test doesn't control (the column default, today).
const DATE_ONLY = expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/);

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

// The other side of each boundary. Each must come back as the same number that was sent: NUMERIC(6,2)
// holds at most 6 significant digits, well within the ~15 a JS number (a float64) keeps exactly.
const VALID_WEIGHTS = [9999.99, 100.12, 0.01];

// Largest value a Postgres INTEGER holds; reps and exercise_id are both INTEGER.
const MAX_PG_INTEGER = 2_147_483_647;

// Integer set fields one past that limit. Postgres rejects them with an out-of-range error (a 500).
// (set_number is INTEGER too, but the server assigns it; a client never sends one.)
const OVERSIZED_INTEGER_FIELDS = [
  ['reps', { reps: MAX_PG_INTEGER + 1 }],
  ['exercise_id', { exercise_id: MAX_PG_INTEGER + 1 }],
] as const;

describe('POST /workouts with a valid token', () => {
  // `let` with a type annotation: assigned in beforeEach, read in the tests.
  let lifter: PublicUser;
  let exerciseId: number;
  let benchId: number;

  beforeEach(async () => {
    await resetDb();
    // A decoy first, so the lifter is id 2: a route that hard-codes user 1 then fails on the
    // user_id, not on a foreign-key error that would hide the real bug.
    await createUser('decoy@example.com', 'password');
    lifter = await createUser('lifter@example.com', 'password');
    exerciseId = (await createExercise('Squat')).id;
    benchId = (await createExercise('Bench')).id;
  });

  it("numbers each exercise's sets 1, 2, 3... in the order they're sent", async () => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({
        // Interleaved, so numbering by position in the whole list would give Bench 2 and 4.
        sets: [
          { exercise_id: exerciseId, reps: 5, weight: 225 },
          { exercise_id: benchId, reps: 8, weight: 135 },
          { exercise_id: exerciseId, reps: 5, weight: 235 },
          { exercise_id: benchId, reps: 8, weight: 140 },
          { exercise_id: exerciseId, reps: 3, weight: 245 },
        ],
      });

    expect(res.status).toBe(201);
    const saved = await pool.query<Pick<WorkoutSet, 'exercise_id' | 'set_number' | 'weight'>>(
      'SELECT exercise_id, set_number, weight FROM sets ORDER BY id'
    );
    expect(saved.rows).toEqual([
      { exercise_id: exerciseId, set_number: 1, weight: 225 },
      { exercise_id: benchId, set_number: 1, weight: 135 },
      { exercise_id: exerciseId, set_number: 2, weight: 235 },
      { exercise_id: benchId, set_number: 2, weight: 140 },
      { exercise_id: exerciseId, set_number: 3, weight: 245 },
    ]);
  });

  // The server assigns set_number, so a client sending one is a mistake worth reporting.
  it.each([
    ['a set_number', { set_number: 1 }],
    ['an unknown field', { rpe: 8 }],
  ])('returns 400 and saves nothing when a set has %s', async (_label, extra) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, reps: 5, weight: 225, ...extra }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect((await pool.query('SELECT id FROM workouts')).rows).toEqual([]);
  });

  it('saves the workout for the user in the token', async () => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, reps: 5, weight: 225 }] });

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
          { exercise_id: exerciseId, reps: 5, weight: 225 },
          { exercise_id: 9999, reps: 5, weight: 225 },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts');
    const sets = await pool.query('SELECT id FROM sets');
    expect(workouts.rows).toEqual([]);
    expect(sets.rows).toEqual([]);
  });

  // Another user's custom exercise gets the same 400 as a missing one, so its id reveals nothing.
  it("returns 400 and saves nothing for another user's custom exercise", async () => {
    const other = await createUser('other@example.com', 'password');
    const theirs = await createExercise('Their Lunge', other.id);

    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: theirs.id, reps: 5, weight: 50 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unknown exercise_id' });
    expect((await pool.query('SELECT id FROM sets')).rows).toEqual([]);
  });

  it("saves a set of the caller's own custom exercise", async () => {
    const mine = await createExercise('My Lunge', lifter.id);

    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: mine.id, reps: 5, weight: 50 }] });

    expect(res.status).toBe(201);
  });

  // JSON.stringify in the title makes ' 2026-10-07' show its leading space in the output.
  it.each(INVALID_DATES)('returns 400 and saves nothing for date %j', async (date) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ date, sets: [{ exercise_id: exerciseId, reps: 5, weight: 225 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts');
    expect(workouts.rows).toEqual([]);
  });

  it.each(VALID_LEAP_DAYS)('saves the leap day %s', async (date) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ date, sets: [{ exercise_id: exerciseId, reps: 5, weight: 225 }] });

    expect(res.status).toBe(201);
    // date::text lets Postgres format the DATE, avoiding JS time-zone conversion.
    const saved = await pool.query<{ date: string }>('SELECT date::text AS date FROM workouts');
    expect(saved.rows).toEqual([{ date }]);
  });

  it.each(INVALID_WEIGHTS)('returns 400 and saves nothing for weight %s', async (weight) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, reps: 5, weight }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts');
    expect(workouts.rows).toEqual([]);
  });

  it.each(VALID_WEIGHTS)('saves weight %s exactly', async (weight) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, reps: 5, weight }] });

    expect(res.status).toBe(201);
    const saved = await pool.query<Pick<WorkoutSet, 'weight'>>('SELECT weight FROM sets');
    expect(saved.rows).toEqual([{ weight }]);
  });

  it.each(OVERSIZED_INTEGER_FIELDS)('returns 400 and saves nothing for %s past the INTEGER max', async (_label, field) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      // Spread order matters: the oversized field comes last, so it overrides the valid one.
      .send({ sets: [{ exercise_id: exerciseId, reps: 5, weight: 100, ...field }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    const workouts = await pool.query('SELECT id FROM workouts');
    expect(workouts.rows).toEqual([]);
  });

  it('saves the largest INTEGER as reps', async () => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authHeader(lifter.id))
      .send({ sets: [{ exercise_id: exerciseId, reps: MAX_PG_INTEGER, weight: 100 }] });

    expect(res.status).toBe(201);
    const saved = await pool.query<Pick<WorkoutSet, 'reps'>>('SELECT reps FROM sets');
    expect(saved.rows).toEqual([{ reps: MAX_PG_INTEGER }]);
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
        date: DATE_ONLY,
        notes: "A's workout",
        sets: [
          { id: expect.any(Number), exercise_id: benchId, exercise_name: 'Bench', set_number: 1, reps: 5, weight: 100, unit: 'lb' },
        ],
      },
    ];
    expect(res.body).toEqual(expected);
  });

  it("nests each workout's own sets under it, grouped by exercise", async () => {
    const workoutA2 = await createWorkout(userA.id, squatId, 'Leg day');
    await setWorkoutDate(workoutA.id, '2026-09-02');
    await setWorkoutDate(workoutA2.id, '2026-09-01');
    // Interleaved across the two workouts, and A's Squat set is added before its second Bench
    // set, so ordering by set_number alone would put Squat 1 between Bench 1 and Bench 2.
    const a2 = await addSet(workoutA.id, squatId, 1, 8, 60);
    const b2 = await addSet(workoutA2.id, squatId, 2, 3, 140);
    const a3 = await addSet(workoutA.id, benchId, 2, 6, 80);

    const res = await request(app).get('/workouts').set('Authorization', authHeader(userA.id));

    expect(res.status).toBe(200);
    const expected: WorkoutDetail[] = [
      {
        id: workoutA.id,
        date: '2026-09-02',
        notes: "A's workout",
        sets: [
          { id: expect.any(Number), exercise_id: benchId, exercise_name: 'Bench', set_number: 1, reps: 5, weight: 100, unit: 'lb' },
          { id: a3.id, exercise_id: benchId, exercise_name: 'Bench', set_number: 2, reps: 6, weight: 80, unit: 'lb' },
          { id: a2.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 8, weight: 60, unit: 'lb' },
        ],
      },
      {
        id: workoutA2.id,
        date: '2026-09-01',
        notes: 'Leg day',
        sets: [
          { id: expect.any(Number), exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: 100, unit: 'lb' },
          { id: b2.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 2, reps: 3, weight: 140, unit: 'lb' },
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
      { id: emptyId, date: '2026-09-05', notes: 'Rest day', sets: [] },
    ]);
    expect(workouts).toHaveLength(2);
  });
});

describe('GET /workouts/:id with a valid token', () => {
  let lifter: PublicUser;
  let squatId: number;
  let benchId: number;
  let rowId: number;
  let workout: Pick<Workout, 'id'>;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
    benchId = (await createExercise('Bench')).id;
    rowId = (await createExercise('Row')).id;
    // createWorkout adds set 1 (Squat, 5 reps, 100).
    workout = await createWorkout(lifter.id, squatId, 'Leg day');
  });

  it("returns the token user's workout with its sets grouped by exercise, in the order each was first added", async () => {
    const day = await createWorkoutOn(lifter.id, '2026-09-05');
    // Row, then Bench, then Squat: neither exercise id order (Squat, Bench, Row) nor name order
    // (Bench, Row, Squat), so only "first added" puts them in this order.
    const row1 = await addSet(day.id, rowId, 1, 10, 70);
    const bench1 = await addSet(day.id, benchId, 1, 8, 60);
    const squat1 = await addSet(day.id, squatId, 1, 5, 100);
    // Squat 3 is added before Squat 2: within an exercise, set_number decides, not the order the
    // sets were added (rows from before the per-exercise migration can look like this).
    const squat3 = await addSet(day.id, squatId, 3, 1, 140);
    const squat2 = await addSet(day.id, squatId, 2, 3, 120.5);
    // Added last, but it's Row's, so it goes with Row's first set.
    const row2 = await addSet(day.id, rowId, 2, 10, 75);

    const res = await request(app)
      .get(`/workouts/${day.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    const expected: WorkoutDetail = {
      id: day.id,
      // Exactly the stored day, whatever the server's time zone (no JS Date in between).
      date: '2026-09-05',
      notes: null,
      sets: [
        // NUMERIC(6,2) comes back as a number (db/pool.ts), so 100, not '100.00'.
        { id: row1.id, exercise_id: rowId, exercise_name: 'Row', set_number: 1, reps: 10, weight: 70, unit: 'lb' },
        { id: row2.id, exercise_id: rowId, exercise_name: 'Row', set_number: 2, reps: 10, weight: 75, unit: 'lb' },
        { id: bench1.id, exercise_id: benchId, exercise_name: 'Bench', set_number: 1, reps: 8, weight: 60, unit: 'lb' },
        { id: squat1.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: 100, unit: 'lb' },
        { id: squat2.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 2, reps: 3, weight: 120.5, unit: 'lb' },
        { id: squat3.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 3, reps: 1, weight: 140, unit: 'lb' },
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
      date: DATE_ONLY,
      notes: 'Heavy leg day',
      sets: [
        { id: expect.any(Number), exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: 100, unit: 'lb' },
      ],
    };
    expect(res.body).toEqual(expected);
    // The response alone could be echoed from the request without saving anything.
    const saved = await pool.query<Pick<Workout, 'notes'>>('SELECT notes FROM workouts WHERE id = $1', [workout.id]);
    expect(saved.rows).toEqual([{ notes: 'Heavy leg day' }]);
  });

  it('updates only the date when notes is missing, leaving notes unchanged', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ date: '2026-09-01' });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: workout.id, date: '2026-09-01', notes: 'Leg day' });
    // date::text, so the check doesn't depend on this machine's time zone.
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

// Straight from the table, to check a write happened whatever the route returned.
// Omit<T, K> is Pick's opposite: every field of T except K.
async function readSet(setId: number): Promise<Omit<WorkoutSet, 'id'> | undefined> {
  const result = await pool.query<Omit<WorkoutSet, 'id'>>(
    'SELECT workout_id, exercise_id, set_number, reps, weight, unit FROM sets WHERE id = $1',
    [setId]
  );
  return result.rows[0];
}

// A workout's sets as [exercise id, set_number] pairs, in the order they were added (by id).
// Straight from the table, so it checks what was saved, not what a route returned.
async function setNumbersOf(workoutId: number): Promise<[number, number][]> {
  const result = await pool.query<Pick<WorkoutSet, 'exercise_id' | 'set_number'>>(
    'SELECT exercise_id, set_number FROM sets WHERE workout_id = $1 ORDER BY id',
    [workoutId]
  );
  return result.rows.map((row) => [row.exercise_id, row.set_number]);
}

describe('PATCH /workouts/:id/sets/:setId with a valid token', () => {
  let lifter: PublicUser;
  let intruder: PublicUser;
  let squatId: number;
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
    // Exercise id 2, for the "an exercise_id" bad body: a real exercise, so only the key is wrong.
    await createExercise('Bench');
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
      date: DATE_ONLY,
      notes: 'Leg day',
      sets: [
        { id: expect.any(Number), exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: 100, unit: 'lb' },
        { id: set.id, exercise_id: squatId, exercise_name: 'Squat', set_number: 2, reps: 4, weight: 125.5, unit: 'lb' },
      ],
    };
    expect(res.body).toEqual(expected);
    expect(await readSet(set.id)).toEqual({ ...original, reps: 4, weight: 125.5 });
  });

  it('updates the unit, leaving the other columns unchanged', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ unit: 'kg' });

    expect(res.status).toBe(200);
    expect(await readSet(set.id)).toEqual({ ...original, unit: 'kg' });
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
    // The server owns set_number, and a set's exercise is fixed: a set logged under the wrong
    // exercise is deleted and added again under the right one.
    ['a set_number', { set_number: 3 }],
    ['an exercise_id', { exercise_id: 2 }],
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

  it.each(VALID_WEIGHTS)('saves weight %s exactly', async (weight) => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ weight });

    expect(res.status).toBe(200);
    expect(await readSet(set.id)).toEqual({ ...original, weight });
  });

  it('returns 400 and changes nothing for reps past the INTEGER max', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ reps: MAX_PG_INTEGER + 1 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await readSet(set.id)).toEqual(original);
  });

  it('saves the largest INTEGER as reps', async () => {
    const res = await request(app)
      .patch(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id))
      .send({ reps: MAX_PG_INTEGER });

    expect(res.status).toBe(200);
    expect(await readSet(set.id)).toEqual({ ...original, reps: MAX_PG_INTEGER });
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

  it('moves the later sets of the same exercise down one, leaving other exercises and workouts alone', async () => {
    // Interleaved with Bench, so renumbering by position in the workout would go wrong.
    const benchId = (await createExercise('Bench')).id;
    await addSet(workout.id, benchId, 1, 8, 135);
    await addSet(workout.id, squatId, 3, 3, 130);
    await addSet(workout.id, benchId, 2, 8, 140);
    await addSet(workout.id, squatId, 4, 3, 140);

    const res = await request(app)
      .delete(`/workouts/${workout.id}/sets/${set.id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(204);
    expect(await setNumbersOf(workout.id)).toEqual([
      [squatId, 1],
      [benchId, 1],
      [squatId, 2],
      [benchId, 2],
      [squatId, 3],
    ]);
    expect(await setNumbersOf(otherWorkout.id)).toEqual([[squatId, 1]]);
  });

  it("changes only the later sets' set_number when set 1 is deleted, not their reps, weight or unit", async () => {
    // Squat 3 differs from set 2 in every column, so a renumbering that touched anything else would show.
    const squat3 = await addSet(workout.id, squatId, 3, 8, 52.5, 'kg');
    const [squat1 = -1] = await setIdsOf(workout.id);
    const set2Before = await readSet(set.id);
    const set3Before = await readSet(squat3.id);

    const res = await request(app)
      .delete(`/workouts/${workout.id}/sets/${squat1}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(204);
    expect(await readSet(set.id)).toEqual({ ...set2Before, set_number: 1 });
    expect(await readSet(squat3.id)).toEqual({ ...set3Before, set_number: 2 });
    expect(await readSet(set.id)).toMatchObject({ reps: 3, weight: 120, unit: 'lb' });
    expect(await readSet(squat3.id)).toMatchObject({ reps: 8, weight: 52.5, unit: 'kg' });
  });

  // An exercise keeps the place it was first added, not the place of its oldest remaining set.
  // Otherwise its card jumps down and its later sets look deleted on the phone.
  it("keeps the exercise's place in the workout when its first set is deleted", async () => {
    // Squat set 2 is added after Bench, as the detail screen's Add set button does.
    const benchId = (await createExercise('Bench')).id;
    const day = await createWorkoutOn(lifter.id, '2026-09-05');
    const squat1 = await addSet(day.id, squatId, 1, 5, 100);
    await addSet(day.id, benchId, 1, 8, 60);
    await addSet(day.id, squatId, 2, 3, 110);

    const res = await request(app)
      .delete(`/workouts/${day.id}/sets/${squat1.id}`)
      .set('Authorization', authHeader(lifter.id));
    expect(res.status).toBe(204);

    const after = await request(app).get(`/workouts/${day.id}`).set('Authorization', authHeader(lifter.id));
    const detail: WorkoutDetail = after.body;
    expect(detail.sets.map((s) => [s.exercise_name, s.set_number, s.reps])).toEqual([
      ['Squat', 1, 3],
      ['Bench', 1, 8],
    ]);
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

    // The list keeps the emptied workout, so the client can still show it.
    const history = await request(app).get('/workouts').set('Authorization', authHeader(lifter.id));
    const workouts: WorkoutDetail[] = history.body;
    expect(workouts.filter((w) => w.id === otherWorkout.id)).toEqual([
      { id: otherWorkout.id, date: DATE_ONLY, notes: 'Another day', sets: [] },
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
    // The owner can lock otherWorkout, but no set was deleted, so nothing may be renumbered.
    expect(await setNumbersOf(workout.id)).toEqual([[squatId, 1], [squatId, 2]]);
    expect(await setNumbersOf(otherWorkout.id)).toEqual([[squatId, 1]]);
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

  it('adds set 1 of an exercise new to the workout and returns 201 with the whole workout', async () => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: benchId, reps: 8, weight: 60.5, unit: 'kg' });

    expect(res.status).toBe(201);
    const expected: WorkoutDetail = {
      id: workout.id,
      date: DATE_ONLY,
      notes: 'Leg day',
      sets: [
        { id: expect.any(Number), exercise_id: squatId, exercise_name: 'Squat', set_number: 1, reps: 5, weight: 100, unit: 'lb' },
        { id: expect.any(Number), exercise_id: benchId, exercise_name: 'Bench', set_number: 1, reps: 8, weight: 60.5, unit: 'kg' },
      ],
    };
    expect(res.body).toEqual(expected);
    // Count the rows too, so a route that inserted twice would fail.
    expect(await setIdsOf(workout.id)).toHaveLength(2);
  });

  it("numbers the set after the highest of the same exercise, whatever other exercises have", async () => {
    // Numbering from the workout's highest set would make the new Squat set 4.
    await addSet(workout.id, benchId, 1, 8, 135);
    await addSet(workout.id, benchId, 2, 8, 135);
    await addSet(workout.id, benchId, 3, 8, 135);

    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 2, weight: 130 });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    // Grouped by exercise, so the new Squat set comes right after Squat 1, before the Bench sets.
    expect(body.sets.map((s) => [s.exercise_name, s.set_number])).toEqual([
      ['Squat', 1],
      ['Squat', 2],
      ['Bench', 1],
      ['Bench', 2],
      ['Bench', 3],
    ]);
    // unit was missing, so it gets the column's default.
    expect(body.sets[1]).toMatchObject({ exercise_id: squatId, set_number: 2, reps: 2, weight: 130, unit: 'lb' });
  });

  // An exercise leaves the workout when its last set goes (the app has no card for an exercise
  // without sets), so adding it again puts it at the end, like any exercise new to the workout.
  it.each([
    ['its last set was deleted', 'set'],
    ['it was removed', 'exercise'],
  ])('adds an exercise after the others when %s and it comes back', async (_label, how) => {
    await addSet(workout.id, benchId, 1, 8, 135);
    const [squat1 = -1] = await setIdsOf(workout.id);
    const removePath =
      how === 'set' ? `/workouts/${workout.id}/sets/${squat1}` : `/workouts/${workout.id}/exercises/${squatId}`;
    const removed = await request(app).delete(removePath).set('Authorization', authHeader(lifter.id));
    expect(removed.status).toBeLessThan(300);

    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 5, weight: 100 });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    expect(body.sets.map((s) => [s.exercise_name, s.set_number])).toEqual([
      ['Bench', 1],
      ['Squat', 1],
    ]);
  });

  it('gives adds sent at the same time distinct, consecutive numbers', async () => {
    // Without the workout lock, two adds could read the same highest number and one would fail (a 500).
    // A race can pass by luck, so this guards the lock rather than proves it.
    const adds = Array.from({ length: 5 }, () =>
      request(app)
        .post(`/workouts/${workout.id}/sets`)
        .set('Authorization', authHeader(lifter.id))
        .send({ exercise_id: squatId, reps: 5, weight: 100 })
        // .then() makes supertest send the request now; without it, nothing is sent until awaited.
        .then((res) => res.status)
    );

    // Promise.all waits for every request, which all run at once.
    expect(await Promise.all(adds)).toEqual([201, 201, 201, 201, 201]);
    const numbers = (await setNumbersOf(workout.id)).map(([, setNumber]) => setNumber);
    expect(numbers.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('leaves no gap or duplicate when a set is added while another is deleted', async () => {
    const squat2 = await addSet(workout.id, squatId, 2, 5, 100);
    await addSet(workout.id, squatId, 3, 5, 100);

    const [deleted, added] = await Promise.all([
      request(app).delete(`/workouts/${workout.id}/sets/${squat2.id}`).set('Authorization', authHeader(lifter.id)),
      request(app)
        .post(`/workouts/${workout.id}/sets`)
        .set('Authorization', authHeader(lifter.id))
        .send({ exercise_id: squatId, reps: 5, weight: 100 }),
    ]);

    expect([deleted.status, added.status]).toEqual([204, 201]);
    // Whichever ran first, three Squat sets remain, numbered 1-3. Without the lock, the add could
    // read 3 as the highest, the delete move 3 down to 2, and the add then save 4: 1, 2, 4.
    const numbers = (await setNumbersOf(workout.id)).map(([, setNumber]) => setNumber);
    expect(numbers.toSorted((a, b) => a - b)).toEqual([1, 2, 3]);
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
      { id: expect.any(Number), exercise_id: benchId, exercise_name: 'Bench', set_number: 1, reps: 10, weight: 40, unit: 'lb' },
    ]);
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

  it("returns 400 and saves nothing for another user's custom exercise", async () => {
    const theirs = await createExercise('Their Lunge', intruder.id);

    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: theirs.id, reps: 5, weight: 100 });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unknown exercise_id' });
    expect(await setIdsOf(workout.id)).toHaveLength(1);
  });

  it("adds a set of the caller's own custom exercise", async () => {
    const mine = await createExercise('My Lunge', lifter.id);

    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: mine.id, reps: 5, weight: 100 });

    expect(res.status).toBe(201);
    expect(await setIdsOf(workout.id)).toHaveLength(2);
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
  // Typed as pairs, or mixing literals with spread .map() rows would infer a loose array.
  type BodyCase = [label: string, body: Record<string, unknown>];
  const invalidBodies: BodyCase[] = [
    ['an empty object', {}],
    ['a missing exercise_id', { reps: 5, weight: 100 }],
    ['missing reps', { exercise_id: 1, weight: 100 }],
    ['a missing weight', { exercise_id: 1, reps: 5 }],
    // The server numbers each exercise's sets, so a client-sent number is rejected, not ignored.
    ['a set_number', { exercise_id: 1, reps: 5, weight: 100, set_number: 2 }],
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

  it.each(VALID_WEIGHTS)('saves weight %s exactly', async (weight) => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: 5, weight });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    expect(body.sets[1]?.weight).toBe(weight);
  });

  it('accepts the largest INTEGER as reps', async () => {
    const res = await request(app)
      .post(`/workouts/${workout.id}/sets`)
      .set('Authorization', authHeader(lifter.id))
      .send({ exercise_id: squatId, reps: MAX_PG_INTEGER, weight: 100 });

    expect(res.status).toBe(201);
    const body: WorkoutDetail = res.body;
    expect(body.sets[1]).toMatchObject({ set_number: 2, reps: MAX_PG_INTEGER });
  });
});

describe('DELETE /workouts/:id/exercises/:exerciseId with a valid token', () => {
  let lifter: PublicUser;
  let intruder: PublicUser;
  let squatId: number;
  let benchId: number;
  let rowId: number;
  let workout: Pick<Workout, 'id'>;
  let intruderWorkout: Pick<Workout, 'id'>;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    intruder = await createUser('intruder@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
    benchId = (await createExercise('Bench')).id;
    rowId = (await createExercise('Row')).id;
    // Squat 1-3 interleaved with Bench 1-2, so the Squat sets weren't added one after another.
    workout = await createWorkout(lifter.id, squatId, 'Mixed day');
    await addSet(workout.id, benchId, 1, 8, 135);
    await addSet(workout.id, squatId, 2, 5, 110);
    await addSet(workout.id, benchId, 2, 8, 140);
    await addSet(workout.id, squatId, 3, 5, 120);
    intruderWorkout = await createWorkout(intruder.id, squatId, 'Intruder day');
  });

  it("removes every set of that exercise and returns the updated workout", async () => {
    const res = await request(app)
      .delete(`/workouts/${workout.id}/exercises/${squatId}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    const body: WorkoutDetail = res.body;
    expect(body).toMatchObject({ id: workout.id, notes: 'Mixed day' });
    // Bench keeps its numbers: they were never shared with Squat.
    expect(body.sets.map((s) => [s.exercise_name, s.set_number])).toEqual([
      ['Bench', 1],
      ['Bench', 2],
    ]);
    // And in the table, not just in the response.
    const squats = await pool.query('SELECT id FROM sets WHERE workout_id = $1 AND exercise_id = $2', [
      workout.id,
      squatId,
    ]);
    expect(squats.rowCount).toBe(0);
  });

  it('leaves the exercise numbered from 1 when a set of it is added while it is removed', async () => {
    const [removed, added] = await Promise.all([
      request(app).delete(`/workouts/${workout.id}/exercises/${squatId}`).set('Authorization', authHeader(lifter.id)),
      request(app)
        .post(`/workouts/${workout.id}/sets`)
        .set('Authorization', authHeader(lifter.id))
        .send({ exercise_id: squatId, reps: 5, weight: 100 }),
    ]);

    expect([removed.status, added.status]).toEqual([200, 201]);
    // Remove first: the add is Squat 1. Add first: it's Squat 4, and the remove takes it too.
    // Without the lock, the add could read 3 as the highest before the remove, and save a lone 4.
    const squats = (await setNumbersOf(workout.id)).filter(([exerciseId]) => exerciseId === squatId);
    expect([[], [[squatId, 1]]]).toContainEqual(squats);
  });

  it("doesn't touch the same exercise in other workouts", async () => {
    await request(app)
      .delete(`/workouts/${workout.id}/exercises/${squatId}`)
      .set('Authorization', authHeader(lifter.id));

    expect(await setIdsOf(intruderWorkout.id)).toHaveLength(1);
  });

  it('keeps the workout, with sets: [], after its last exercise is removed', async () => {
    await request(app)
      .delete(`/workouts/${workout.id}/exercises/${squatId}`)
      .set('Authorization', authHeader(lifter.id));
    const res = await request(app)
      .delete(`/workouts/${workout.id}/exercises/${benchId}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: workout.id, date: DATE_ONLY, notes: 'Mixed day', sets: [] });
  });

  it('returns 404 for an exercise the workout has no sets of', async () => {
    const before = await setIdsOf(workout.id);

    const res = await request(app)
      .delete(`/workouts/${workout.id}/exercises/${rowId}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Exercise not in this workout' });
    expect(await setIdsOf(workout.id)).toEqual(before);
  });

  it("returns 404 for an exercise id that doesn't exist", async () => {
    const res = await request(app)
      .delete(`/workouts/${workout.id}/exercises/999999`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Exercise not in this workout' });
  });

  it('returns 404 when the same exercise is removed twice', async () => {
    const first = await request(app)
      .delete(`/workouts/${workout.id}/exercises/${squatId}`)
      .set('Authorization', authHeader(lifter.id));
    const second = await request(app)
      .delete(`/workouts/${workout.id}/exercises/${squatId}`)
      .set('Authorization', authHeader(lifter.id));

    expect(first.status).toBe(200);
    expect(second.status).toBe(404);
  });

  it("returns 404 Workout not found for a workout id that doesn't exist", async () => {
    const res = await request(app)
      .delete(`/workouts/999999/exercises/${squatId}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Workout not found' });
  });

  it("returns the same 404 as a missing workout for another user's workout, and deletes nothing", async () => {
    const before = await setIdsOf(workout.id);

    const res = await request(app)
      .delete(`/workouts/${workout.id}/exercises/${squatId}`)
      .set('Authorization', authHeader(intruder.id));

    // Same body as a missing id, so an intruder can't tell the workout exists.
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Workout not found' });
    expect(await setIdsOf(workout.id)).toEqual(before);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).delete(`/workouts/${workout.id}/exercises/${squatId}`);

    expect(res.status).toBe(401);
    expect(await setIdsOf(workout.id)).toHaveLength(5);
  });

  it.each(INVALID_IDS)('returns 400 for workout id %s', async (id) => {
    const res = await request(app)
      .delete(`/workouts/${id}/exercises/${squatId}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each(INVALID_IDS)('returns 400 for exercise id %s', async (id) => {
    const res = await request(app)
      .delete(`/workouts/${workout.id}/exercises/${id}`)
      .set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});
