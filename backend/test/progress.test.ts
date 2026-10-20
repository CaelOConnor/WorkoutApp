import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { addSet, createExercise, createUser, createWorkoutOn, pool, resetDb } from './db';
import type {
  ExerciseProgress,
  LoggedExercise,
  PublicUser,
  WeightUnit,
} from '../src/types/models';

afterAll(async () => {
  await pool.end();
});

// One set as [reps, weight, unit?]. A labeled tuple type: the labels only document the positions.
type SetSpec = [reps: number, weight: number, unit?: WeightUnit];

// Logs one workout on `date` with the given sets of one exercise, numbered 1..n.
async function logDay(userId: number, date: string, exerciseId: number, sets: SetSpec[]) {
  const workout = await createWorkoutOn(userId, date);
  // entries() gives [index, value] pairs, so the loop can number the sets.
  for (const [i, [reps, weight, unit]] of sets.entries()) {
    await addSet(workout.id, exerciseId, i + 1, reps, weight, unit);
  }
}

describe('GET /exercises/:id/progress', () => {
  let lifter: PublicUser;
  let other: PublicUser;
  let squatId: number;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    other = await createUser('other@example.com', 'password');
    squatId = (await createExercise('Squat')).id;
  });

  // Small wrapper so each test reads as "the progress for this query".
  function getProgress(exerciseId: number | string, query = '', userId = lifter.id) {
    return request(app)
      .get(`/exercises/${exerciseId}/progress${query}`)
      .set('Authorization', authHeader(userId));
  }

  it('returns 401 without a token', async () => {
    const res = await request(app).get(`/exercises/${squatId}/progress`);

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('gives one point per workout day, oldest first, with each metric', async () => {
    // Logged out of order, and two workouts on 09-03, which must merge into one point.
    await logDay(lifter.id, '2026-09-03', squatId, [[8, 100]]);
    await logDay(lifter.id, '2026-09-03', squatId, [[5, 105]]);
    await logDay(lifter.id, '2026-09-01', squatId, [[5, 100], [3, 110], [1, 120]]);

    const res = await getProgress(squatId);

    expect(res.status).toBe(200);
    const expected: ExerciseProgress = {
      exercise_id: squatId,
      exercise_name: 'Squat',
      unit: 'lb',
      points: [
        // volume: 500 + 330 + 120.
        { date: '2026-09-01', top_weight: 120, volume: 950, sets: 3 },
        // volume: 800 + 525.
        { date: '2026-09-03', top_weight: 105, volume: 1325, sets: 2 },
      ],
    };
    expect(res.body).toEqual(expected);
  });

  it.each([
    // 200 lb = 90.718474 kg, so 100 kg is the top set. Unconverted, 200 would win.
    ['kg', { top_weight: 100, volume: 190.7 }],
    // 100 kg = 220.462262 lb.
    ['lb', { top_weight: 220.5, volume: 420.5 }],
  ] as const)('converts every set to %s before aggregating', async (unit, metrics) => {
    await logDay(lifter.id, '2026-09-01', squatId, [[1, 100, 'kg'], [1, 200, 'lb']]);

    const res = await getProgress(squatId, `?unit=${unit}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      unit,
      points: [{ date: '2026-09-01', ...metrics, sets: 2 }],
    });
  });

  it("defaults to the unit of the exercise's most recent set with reps", async () => {
    await logDay(lifter.id, '2026-09-01', squatId, [[5, 100, 'lb']]);
    await logDay(lifter.id, '2026-09-02', squatId, [[5, 50, 'kg']]);
    // Newer, but 0 reps (the app's 0 × 0 placeholder), so it doesn't decide the unit.
    await logDay(lifter.id, '2026-09-03', squatId, [[0, 0, 'lb']]);
    // Another user's newer set doesn't either.
    await logDay(other.id, '2026-09-04', squatId, [[5, 100, 'lb']]);

    const res = await getProgress(squatId);

    expect(res.status).toBe(200);
    const body: ExerciseProgress = res.body;
    expect(body.unit).toBe('kg');
    expect(body.points).toEqual([
      // 100 lb = 45.359237 kg
      { date: '2026-09-01', top_weight: 45.4, volume: 226.8, sets: 1 },
      { date: '2026-09-02', top_weight: 50, volume: 250, sets: 1 },
    ]);
  });

  it('ignores sets with 0 reps, and leaves out days that only have those', async () => {
    // 0 × 300 is a failed attempt: it mustn't become the top set.
    await logDay(lifter.id, '2026-09-01', squatId, [[5, 100], [0, 300]]);
    await logDay(lifter.id, '2026-09-02', squatId, [[0, 0]]);

    const res = await getProgress(squatId);

    expect(res.status).toBe(200);
    expect(res.body.points).toEqual([
      { date: '2026-09-01', top_weight: 100, volume: 500, sets: 1 },
    ]);
  });

  it('keeps bodyweight sets (weight 0) as zeros', async () => {
    await logDay(lifter.id, '2026-09-01', squatId, [[10, 0]]);

    const res = await getProgress(squatId);

    expect(res.body.points).toEqual([
      { date: '2026-09-01', top_weight: 0, volume: 0, sets: 1 },
    ]);
  });

  it("counts only the caller's sets", async () => {
    await logDay(other.id, '2026-09-01', squatId, [[1, 500]]);
    await logDay(lifter.id, '2026-09-02', squatId, [[5, 100]]);

    const res = await getProgress(squatId);

    const body: ExerciseProgress = res.body;
    expect(body.points.map((p) => p.date)).toEqual(['2026-09-02']);
  });

  it.each([
    ['?from=2026-09-02', ['2026-09-02', '2026-09-03']],
    ['?to=2026-09-02', ['2026-09-01', '2026-09-02']],
    ['?from=2026-09-02&to=2026-09-02', ['2026-09-02']],
    ['?unit=lb&from=2026-08-01&to=2026-12-31', ['2026-09-01', '2026-09-02', '2026-09-03']],
  ])('limits the dates to %s, inclusive', async (query, dates) => {
    for (const date of ['2026-09-01', '2026-09-02', '2026-09-03']) {
      await logDay(lifter.id, date, squatId, [[5, 100]]);
    }

    const res = await getProgress(squatId, query);

    expect(res.status).toBe(200);
    const body: ExerciseProgress = res.body;
    expect(body.points.map((p) => p.date)).toEqual(dates);
  });

  it('returns no points, in lb, for an exercise never logged', async () => {
    const res = await getProgress(squatId);

    expect(res.status).toBe(200);
    const expected: ExerciseProgress = {
      exercise_id: squatId,
      exercise_name: 'Squat',
      unit: 'lb',
      points: [],
    };
    expect(res.body).toEqual(expected);
  });

  it("works for the caller's own custom exercise", async () => {
    const mine = await createExercise('My Lunge', lifter.id);
    await logDay(lifter.id, '2026-09-01', mine.id, [[5, 40]]);

    const res = await getProgress(mine.id);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ exercise_name: 'My Lunge', points: [{ date: '2026-09-01' }] });
  });

  it("returns 404 for a missing exercise or another user's custom one", async () => {
    const theirs = await createExercise('Their Lunge', other.id);

    for (const id of [9999, theirs.id]) {
      const res = await getProgress(id);
      expect(res.status).toBe(404);
      expect(res.body).toEqual({ error: 'Exercise not found' });
    }
  });

  it.each([
    ['an invalid id', 'abc', ''],
    ['an unknown unit', null, '?unit=stone'],
    ['an impossible from date', null, '?from=2026-02-30'],
    ['a to date in another format', null, '?to=10/01/2026'],
    ['from after to', null, '?from=2026-09-03&to=2026-09-01'],
    // Express turns a repeated key into an array.
    ['a repeated unit', null, '?unit=kg&unit=lb'],
    // Rejected rather than ignored, so a typo like ?form= doesn't silently mean "all time".
    ['an unknown parameter', null, '?form=2026-09-01'],
  ])('returns 400 for %s', async (_label, id, query) => {
    const res = await getProgress(id ?? squatId, query);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

describe('GET /exercises/logged', () => {
  let lifter: PublicUser;
  let other: PublicUser;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    other = await createUser('other@example.com', 'password');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/exercises/logged');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('lists exercises with a set of 1+ reps, most recently logged first', async () => {
    const squat = (await createExercise('Squat')).id;
    const bench = (await createExercise('Bench')).id;
    const deadlift = (await createExercise('Deadlift')).id;
    const press = (await createExercise('Overhead Press')).id;
    const curl = (await createExercise('Curl')).id;
    await createExercise('Row'); // never logged
    const theirs = (await createExercise('Their Lunge', other.id)).id;

    await logDay(lifter.id, '2026-09-01', squat, [[5, 100, 'lb']]);
    await logDay(lifter.id, '2026-09-01', bench, [[5, 60, 'kg']]);
    await logDay(lifter.id, '2026-09-01', press, [[5, 40, 'lb']]);
    await logDay(lifter.id, '2026-09-02', deadlift, [[5, 140, 'lb']]);
    // Squat's most recent set is in kg now.
    await logDay(lifter.id, '2026-09-03', squat, [[3, 50, 'kg']]);
    // Only a 0-rep set: nothing to chart, so not listed.
    await logDay(lifter.id, '2026-09-04', curl, [[0, 0, 'lb']]);
    // Another user's custom exercise, logged by them. (The lifter can't log it: the
    // sets_exercise_visible trigger rejects that, see workouts.test.ts.)
    await logDay(other.id, '2026-09-04', theirs, [[5, 20, 'lb']]);
    // Another user's newer Bench set changes neither Bench's date nor its unit.
    await logDay(other.id, '2026-09-05', bench, [[5, 100, 'lb']]);

    const res = await request(app).get('/exercises/logged').set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    const expected: LoggedExercise[] = [
      { id: squat, name: 'Squat', last_date: '2026-09-03', unit: 'kg' },
      { id: deadlift, name: 'Deadlift', last_date: '2026-09-02', unit: 'lb' },
      // Same day: by name.
      { id: bench, name: 'Bench', last_date: '2026-09-01', unit: 'kg' },
      { id: press, name: 'Overhead Press', last_date: '2026-09-01', unit: 'lb' },
    ];
    expect(res.body).toEqual(expected);
  });

  it('returns [] for a user who has logged nothing', async () => {
    const res = await request(app).get('/exercises/logged').set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
