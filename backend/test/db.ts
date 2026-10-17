import bcrypt from 'bcrypt';
import pool from '../src/db/pool';
import type { Exercise, PublicUser, WeightUnit, Workout, WorkoutSet } from '../src/types/models';

// Empties every table and resets SERIAL ids to 1, so each test starts from a known state.
export async function resetDb(): Promise<void> {
  await pool.query(
    'TRUNCATE users, exercises, workouts, workout_exercises, sets, templates, template_exercises RESTART IDENTITY CASCADE'
  );
}

// A set's exercise must be one of its workout's exercises (sets_workout_exercise_fkey), so the
// helpers that insert sets directly add the workout_exercises row first, after the workout's other
// exercises, like the routes do. ON CONFLICT DO NOTHING: already in the workout, nothing to add.
async function addWorkoutExercise(workoutId: number, exerciseId: number): Promise<void> {
  await pool.query(
    `INSERT INTO workout_exercises (workout_id, exercise_id, position)
     SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM workout_exercises WHERE workout_id = $1
     ON CONFLICT (workout_id, exercise_id) DO NOTHING`,
    [workoutId, exerciseId]
  );
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
// Built-in (created_by NULL) unless createdBy names the user whose custom exercise it is.
export async function createExercise(
  name: string,
  createdBy: number | null = null
): Promise<Pick<Exercise, 'id'>> {
  const result = await pool.query<Pick<Exercise, 'id'>>(
    'INSERT INTO exercises (name, created_by) VALUES ($1, $2) RETURNING id',
    [name, createdBy]
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
  await addWorkoutExercise(workout.id, exerciseId);
  await pool.query(
    'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight) VALUES ($1, $2, 1, 5, 100)',
    [workout.id, exerciseId]
  );
  return workout;
}

// An empty workout on a given day, for tests where the date matters (createWorkout uses today).
export async function createWorkoutOn(userId: number, date: string): Promise<Pick<Workout, 'id'>> {
  const result = await pool.query<Pick<Workout, 'id'>>(
    'INSERT INTO workouts (user_id, date) VALUES ($1, $2) RETURNING id',
    [userId, date]
  );
  const workout = result.rows[0];
  if (!workout) {
    throw new Error('createWorkoutOn: insert returned no row');
  }
  return workout;
}

// Adds one more set to an existing workout, for tests that need several sets.
// A default parameter value (unit = 'lb') makes the argument optional for callers.
export async function addSet(
  workoutId: number,
  exerciseId: number,
  setNumber: number,
  reps: number,
  weight: number,
  unit: WeightUnit = 'lb'
): Promise<Pick<WorkoutSet, 'id'>> {
  await addWorkoutExercise(workoutId, exerciseId);
  const result = await pool.query<Pick<WorkoutSet, 'id'>>(
    'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight, unit) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
    [workoutId, exerciseId, setNumber, reps, weight, unit]
  );
  const set = result.rows[0];
  if (!set) {
    throw new Error('addSet: insert returned no row');
  }
  return set;
}

export { pool };
