import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../src/db/seed';
import { SAMPLE_NOTES_PREFIX, seedSampleWorkouts } from '../src/db/seed-sample-workouts';
import { createExercise, createUser, createWorkout, pool, resetDb } from './db';

afterAll(async () => {
  await pool.end();
});

const EMAIL = 'you@test.com';
const TODAY = '2026-10-13';
const THREE_WEEKS_AGO = '2026-09-23'; // the oldest day in the 21 days ending TODAY

// The rows the seeder wrote, newest first. ::text keeps Postgres's 'YYYY-MM-DD' (pool.ts does the
// same for DATE), and COUNT is cast to int so pg returns a number instead of a bigint string.
async function sampleWorkouts(userId: number) {
  const result = await pool.query<{ id: number; date: string; notes: string; set_count: number }>(
    `SELECT w.id, w.date::text AS date, w.notes, COUNT(s.id)::int AS set_count
     FROM workouts w LEFT JOIN sets s ON s.workout_id = w.id
     WHERE w.user_id = $1
     GROUP BY w.id
     ORDER BY w.date DESC`,
    [userId]
  );
  return result.rows;
}

describe('seedSampleWorkouts', () => {
  beforeEach(async () => {
    await resetDb();
    await seed(); // the built-in exercises the samples use
  });

  it('adds workouts with sets over the last three weeks, up to today', async () => {
    const user = await createUser(EMAIL, 'pw');

    const inserted = await seedSampleWorkouts(EMAIL, TODAY);

    const rows = await sampleWorkouts(user.id);
    expect(rows).toHaveLength(inserted);
    expect(rows.length).toBeGreaterThanOrEqual(6);
    // Today is included, so "This week" always has something however the weeks fall.
    expect(rows[0]?.date).toBe(TODAY);
    for (const row of rows) {
      expect(row.date >= THREE_WEEKS_AGO && row.date <= TODAY).toBe(true);
      expect(row.notes.startsWith(SAMPLE_NOTES_PREFIX)).toBe(true);
      expect(row.set_count).toBeGreaterThan(0);
    }
    // A mix of exercises: every built-in one is used somewhere.
    const used = await pool.query<{ name: string }>(
      `SELECT DISTINCT e.name FROM sets s
       JOIN exercises e ON e.id = s.exercise_id
       JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = $1 ORDER BY e.name`,
      [user.id]
    );
    expect(used.rows.map((r) => r.name)).toEqual([
      'Barbell Row',
      'Bench Press',
      'Deadlift',
      'Overhead Press',
      'Squat',
    ]);
  });

  it("numbers each exercise's sets 1..n within every workout, like the API does", async () => {
    await createUser(EMAIL, 'pw');
    await seedSampleWorkouts(EMAIL, TODAY);

    // array_agg collects a group's values into one Postgres array (a JS array once pg reads it),
    // here each exercise's set numbers in one workout, in the order the sets were added.
    const result = await pool.query<{ numbers: number[] }>(
      'SELECT array_agg(set_number ORDER BY id) AS numbers FROM sets GROUP BY workout_id, exercise_id'
    );
    expect(result.rows.length).toBeGreaterThan(0);
    for (const { numbers } of result.rows) {
      // Array.from({ length: n }, fn) builds [fn(_, 0), fn(_, 1), ...], here [1, 2, ..., n].
      expect(numbers).toEqual(Array.from({ length: numbers.length }, (_, i) => i + 1));
    }
  });

  it('replaces its own workouts when rerun, leaving the rest alone', async () => {
    const user = await createUser(EMAIL, 'pw');
    const other = await createUser('other@test.com', 'pw');
    const squat = await createExercise('Custom Squat');
    const mine = await createWorkout(user.id, squat.id, 'My real workout');
    const theirs = await createWorkout(other.id, squat.id, 'Sample: not mine to delete');

    const first = await seedSampleWorkouts(EMAIL, TODAY);
    const firstIds = (await sampleWorkouts(user.id)).map((r) => r.id);
    const second = await seedSampleWorkouts(EMAIL, TODAY);

    const rows = await sampleWorkouts(user.id);
    // Same number of samples, all new rows (the old ones were deleted, not added to)...
    expect(second).toBe(first);
    expect(rows.filter((r) => r.notes.startsWith(SAMPLE_NOTES_PREFIX))).toHaveLength(first);
    expect(rows.some((r) => firstIds.includes(r.id) && r.id !== mine.id)).toBe(false);
    // ...the user's own workout survived, and so did another user's, even with a "Sample:" note.
    expect(rows.map((r) => r.id)).toContain(mine.id);
    const otherRows = await sampleWorkouts(other.id);
    expect(otherRows.map((r) => r.id)).toEqual([theirs.id]);
  });

  it('fails clearly for an unknown email', async () => {
    await expect(seedSampleWorkouts('nobody@test.com', TODAY)).rejects.toThrow(
      /No user with email nobody@test.com/
    );
  });

  it('fails clearly when the built-in exercises are missing, and writes nothing', async () => {
    await resetDb();
    const user = await createUser(EMAIL, 'pw');

    await expect(seedSampleWorkouts(EMAIL, TODAY)).rejects.toThrow(/npm run seed/);
    expect(await sampleWorkouts(user.id)).toEqual([]);
  });
});
