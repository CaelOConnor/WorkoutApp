import pool from './pool';

// Sample workouts for trying the app with data: about three a week over the last three weeks,
// using the built-in exercises from seed.ts, with weights creeping up so progress is visible.
//
//   npm run seed:sample                     # for you@test.com
//   npm run seed:sample -- someone@test.com
//
// Safe to rerun: every sample workout's notes start with SAMPLE_NOTES_PREFIX, and a rerun deletes
// the user's sample workouts (their sets go with them, ON DELETE CASCADE) before adding fresh ones
// dated from the new "today". Workouts the user logged themselves are left alone.

export const SAMPLE_NOTES_PREFIX = 'Sample:';
const DEFAULT_EMAIL = 'you@test.com';

// One exercise in a session: its sets' reps, and the weight on the first time it's done.
interface PlannedExercise {
  name: string;
  reps: number[];
  startWeight: number;
}

// `as const satisfies`: keeps the exact keys ('push' | 'pull' | 'legs') for SessionName below,
// while still checking each value is a PlannedExercise[].
const SESSIONS = {
  push: [
    { name: 'Bench Press', reps: [8, 8, 6], startWeight: 135 },
    { name: 'Overhead Press', reps: [8, 8, 8], startWeight: 85 },
  ],
  pull: [
    { name: 'Deadlift', reps: [5, 5, 3], startWeight: 225 },
    { name: 'Barbell Row', reps: [10, 8, 8], startWeight: 115 },
  ],
  legs: [{ name: 'Squat', reps: [5, 5, 5, 5], startWeight: 185 }],
} as const satisfies Record<string, readonly PlannedExercise[]>;

type SessionName = keyof typeof SESSIONS;

// [days before today, session], oldest first. 20 days back to today is three weeks, and today is
// included so "This week" always has something, whatever weekday the script runs on.
const PLAN: [daysAgo: number, session: SessionName][] = [
  [20, 'push'],
  [18, 'pull'],
  [16, 'legs'],
  [14, 'push'],
  [11, 'pull'],
  [9, 'legs'],
  [7, 'push'],
  [4, 'pull'],
  [2, 'legs'],
  [0, 'push'],
];

// Each repeat of a session adds this much to every lift.
const WEIGHT_STEP = 5;

// 'YYYY-MM-DD' minus `days`, as calendar days. Date.UTC and the UTC getters have no time zone
// or daylight saving, so the arithmetic can't land on the wrong day.
function subtractDays(date: string, days: number): string {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

// Today on this computer's calendar, not the database's: the Postgres container runs in UTC,
// so its CURRENT_DATE is already tomorrow on a US evening.
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Replaces `email`'s sample workouts with a fresh set ending on `today` ('YYYY-MM-DD').
// Returns how many workouts it added. `today` is a parameter so tests can fix it.
export async function seedSampleWorkouts(email: string, today: string): Promise<number> {
  const user = await pool.query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
  const userId = user.rows[0]?.id;
  if (userId === undefined) {
    throw new Error(`No user with email ${email}. Sign up in the app first.`);
  }

  // Built-in exercises only (created_by IS NULL): a user's custom exercise may share a name.
  const exercises = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM exercises WHERE created_by IS NULL'
  );
  const exerciseIds = new Map(exercises.rows.map((e) => [e.name, e.id]));
  const needed = Object.values(SESSIONS).flatMap((session) => session.map((e) => e.name));
  const missing = needed.filter((name) => !exerciseIds.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing built-in exercises (${missing.join(', ')}). Run npm run seed first.`);
  }

  // One client for the whole transaction: a pool may hand each pool.query a different connection,
  // and BEGIN/COMMIT only cover queries on the same one. Either everything is replaced or nothing.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // LIKE treats % and _ as wildcards; the prefix has neither, so this is a plain "starts with".
    await client.query('DELETE FROM workouts WHERE user_id = $1 AND notes LIKE $2', [
      userId,
      `${SAMPLE_NOTES_PREFIX}%`,
    ]);

    // How many times each session has been done so far, for the weight progression.
    const timesDone: Record<SessionName, number> = { push: 0, pull: 0, legs: 0 };
    for (const [daysAgo, session] of PLAN) {
      const workout = await client.query<{ id: number }>(
        'INSERT INTO workouts (user_id, date, notes) VALUES ($1, $2, $3) RETURNING id',
        [userId, subtractDays(today, daysAgo), `${SAMPLE_NOTES_PREFIX} ${session} day`]
      );
      const workoutId = workout.rows[0]?.id;
      if (workoutId === undefined) {
        throw new Error('Workout insert returned no row');
      }

      const extra = timesDone[session] * WEIGHT_STEP;
      timesDone[session] += 1;
      // set_number runs on across the whole workout (1, 2, 3, ...), like a set logged in the app.
      let setNumber = 0;
      for (const exercise of SESSIONS[session]) {
        for (const reps of exercise.reps) {
          setNumber += 1;
          await client.query(
            'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight) VALUES ($1, $2, $3, $4, $5)',
            [workoutId, exerciseIds.get(exercise.name), setNumber, reps, exercise.startWeight + extra]
          );
        }
      }
    }

    await client.query('COMMIT');
    return PLAN.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Run from the command line (npm run seed:sample), not when a test imports this file.
if (require.main === module) {
  const email = process.argv[2] ?? DEFAULT_EMAIL;
  // Sample data is for the dev database. The test database is rebuilt by the tests themselves.
  const database = new URL(process.env.DATABASE_URL ?? '').pathname.slice(1);
  if (database.endsWith('_test')) {
    console.error(`Refusing to add sample workouts to the test database (${database}).`);
    process.exitCode = 1;
    void pool.end();
  } else {
    seedSampleWorkouts(email, localToday())
      .then((count) => console.log(`Added ${count} sample workouts for ${email} in ${database}`))
      .catch((err: unknown) => {
        console.error('Sample seed failed:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
      })
      .finally(() => pool.end());
  }
}
