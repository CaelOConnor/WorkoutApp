import pool from './pool';

// Dev tool: adds about three weeks of sample workouts so the app has data to show.
//   npm run seed:sample                     (for you@test.com)
//   npm run seed:sample -- someone@test.com
// Safe to rerun: sample workouts are marked by their notes, and a rerun replaces only those.

export const SAMPLE_NOTES_PREFIX = 'Sample:';
const DEFAULT_EMAIL = 'you@test.com';

interface PlannedExercise {
  name: string;
  reps: number[];
  startWeight: number;
}

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

// [days before today, session], oldest first. Includes today so "This week" always has data.
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

// Each repeat of a session adds this much weight, so the charts show progress.
const WEIGHT_STEP = 5;

// Date math in UTC, so time zones and daylight saving can't shift the day.
function subtractDays(date: string, days: number): string {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

// Today on this computer's calendar. The database runs in UTC, so its date is
// already tomorrow on a US evening.
function localToday(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// Replaces the user's sample workouts with a fresh set ending on `today`.
// `today` is a parameter so tests can fix the date.
export async function seedSampleWorkouts(email: string, today: string): Promise<number> {
  const user = await pool.query<{ id: number }>('SELECT id FROM users WHERE email = $1', [email]);
  const userId = user.rows[0]?.id;
  if (userId === undefined) {
    throw new Error(`No user with email ${email}. Sign up in the app first.`);
  }

  // Built-in exercises only, since a custom exercise could have the same name.
  const exercises = await pool.query<{ id: number; name: string }>(
    'SELECT id, name FROM exercises WHERE created_by IS NULL'
  );
  const exerciseIds = new Map(exercises.rows.map((e) => [e.name, e.id]));
  const needed = Object.values(SESSIONS).flatMap((session) => session.map((e) => e.name));
  const missing = needed.filter((name) => !exerciseIds.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing built-in exercises (${missing.join(', ')}). Run npm run seed first.`);
  }

  // One transaction: either all the samples are replaced or nothing changes.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Deletes only sample workouts. Their sets go with them.
    await client.query('DELETE FROM workouts WHERE user_id = $1 AND notes LIKE $2', [
      userId,
      `${SAMPLE_NOTES_PREFIX}%`,
    ]);

    // How many times each session has been done so far, for the weight increase.
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
      for (const [exerciseIndex, exercise] of SESSIONS[session].entries()) {
        const exerciseId = exerciseIds.get(exercise.name);
        // The exercise must be added to the workout before its sets.
        await client.query(
          'INSERT INTO workout_exercises (workout_id, exercise_id, position) VALUES ($1, $2, $3)',
          [workoutId, exerciseId, exerciseIndex + 1]
        );
        for (const [index, reps] of exercise.reps.entries()) {
          await client.query(
            'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight) VALUES ($1, $2, $3, $4, $5)',
            [workoutId, exerciseId, index + 1, reps, exercise.startWeight + extra]
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

// Only runs from the command line, not when a test imports this file.
if (require.main === module) {
  const email = process.argv[2] ?? DEFAULT_EMAIL;
  // Never add sample data to the test database.
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