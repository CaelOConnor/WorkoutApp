import bcrypt from 'bcrypt';
import pool from '../src/db/pool';
import type { Exercise, PublicUser, Workout, WorkoutSet } from '../src/types/models';

// Empties every table and resets SERIAL ids to 1, so each test starts from a known state.
export async function resetDb(): Promise<void> {
  await pool.query('TRUNCATE users, exercises, workouts, sets RESTART IDENTITY CASCADE');
}

// Inserts a user directly (not through /auth/signup) so a login test doesn't depend on signup working.
export async function createUser(email: string, password: string): Promise<PublicUser> {
  const passwordHash = await bcrypt.hash(password, 10);
  const result = await pool.query<PublicUser>(
    'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
    [email, passwordHash]
  );
  const user = result.rows[0];
  if (!user) {
    throw new Error('createUser: insert returned no row');
  }
  return user;
}

// Inserts an exercise so sets have a real exercise_id to point at (sets.exercise_id is a foreign key).
export async function createExercise(name: string): Promise<Pick<Exercise, 'id'>> {
  const result = await pool.query<Pick<Exercise, 'id'>>(
    'INSERT INTO exercises (name) VALUES ($1) RETURNING id',
    [name]
  );
  const exercise = result.rows[0];
  if (!exercise) {
    throw new Error('createExercise: insert returned no row');
  }
  return exercise;
}

// Inserts a workout with one set for the given user, so tests have a typical workout to read,
// edit, and delete without adding sets by hand.
export async function createWorkout(
  userId: number,
  exerciseId: number,
  notes: string
): Promise<Pick<Workout, 'id'>> {
  const result = await pool.query<Pick<Workout, 'id'>>(
    'INSERT INTO workouts (user_id, notes) VALUES ($1, $2) RETURNING id',
    [userId, notes]
  );
  const workout = result.rows[0];
  if (!workout) {
    throw new Error('createWorkout: insert returned no row');
  }
  await pool.query(
    'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight) VALUES ($1, $2, 1, 5, 100)',
    [workout.id, exerciseId]
  );
  return workout;
}

// Adds one more set to an existing workout, for tests that need several sets.
export async function addSet(
  workoutId: number,
  exerciseId: number,
  setNumber: number,
  reps: number,
  weight: number
): Promise<Pick<WorkoutSet, 'id'>> {
  const result = await pool.query<Pick<WorkoutSet, 'id'>>(
    'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    [workoutId, exerciseId, setNumber, reps, weight]
  );
  const set = result.rows[0];
  if (!set) {
    throw new Error('addSet: insert returned no row');
  }
  return set;
}

export { pool };
