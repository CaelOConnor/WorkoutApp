import pool from './pool';
import type { Workout, WorkoutDetail, WorkoutDetailSet } from '../types/models';

type WorkoutColumns = Pick<Workout, 'id' | 'date' | 'notes'>;

// Loads the sets for all the given workouts in one query and nests them.
// 2 queries total instead of one per workout (the N+1 problem).
async function attachSets(workouts: WorkoutColumns[]): Promise<WorkoutDetail[]> {
  if (workouts.length === 0) {
    return [];
  }
  // ANY($1) matches any id in the array, so one placeholder covers every workout.
  // Sorted by the exercise's stored position, then set number.
  const setsResult = await pool.query<WorkoutDetailSet & { workout_id: number }>(
    `SELECT s.workout_id, s.id, s.exercise_id, e.name AS exercise_name, s.set_number, s.reps, s.weight, s.unit
     FROM sets s
     JOIN workout_exercises we ON we.workout_id = s.workout_id AND we.exercise_id = s.exercise_id
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = ANY($1::int[])
     ORDER BY we.position, s.set_number`,
    [workouts.map((w) => w.id)]
  );

  // Group the sets by workout. Rows are already in display order, so push keeps it.
  const setsByWorkout = new Map<number, WorkoutDetailSet[]>();
  for (const { workout_id, ...set } of setsResult.rows) {
    // ...set is every field except workout_id, which isn't sent to the app.
    const list = setsByWorkout.get(workout_id) ?? [];
    list.push(set);
    setsByWorkout.set(workout_id, list);
  }

  // A workout with no sets gets an empty list.
  return workouts.map((workout) => ({ ...workout, sets: setsByWorkout.get(workout.id) ?? [] }));
}

// One workout with its sets, or null if it doesn't exist or isn't this user's.
// Here rather than in a router because the workouts and sets routes both use it.
export async function loadWorkoutDetail(id: number, userId: number): Promise<WorkoutDetail | null> {
  const workoutResult = await pool.query<WorkoutColumns>(
    'SELECT id, date, notes FROM workouts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  const workout = workoutResult.rows[0];
  if (!workout) {
    return null;
  }
  const [detail] = await attachSets([workout]);
  return detail ?? null;
}

// All of a user's workouts, newest first. Same-day workouts sort by id so the order never shuffles.
export async function listWorkoutDetails(userId: number): Promise<WorkoutDetail[]> {
  const workoutsResult = await pool.query<WorkoutColumns>(
    'SELECT id, date, notes FROM workouts WHERE user_id = $1 ORDER BY date DESC, id DESC',
    [userId]
  );
  return attachSets(workoutsResult.rows);
}