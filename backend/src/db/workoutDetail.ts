import pool from './pool';
import type { Workout, WorkoutDetail, WorkoutDetailSet } from '../types/models';

// One workout with its sets nested, or null if it doesn't exist or belongs to someone else.
// Filtering on user_id in SQL means another user's workout simply isn't found, so callers give
// it the same 404 as a missing id and the response can't reveal that it exists.
// Lives here rather than in a router because both the workouts and sets routers return it.
export async function loadWorkoutDetail(id: number, userId: number): Promise<WorkoutDetail | null> {
  const workoutResult = await pool.query<Pick<Workout, 'id' | 'date' | 'notes'>>(
    'SELECT id, date, notes FROM workouts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  const workout = workoutResult.rows[0];
  if (!workout) {
    return null;
  }

  const setsResult = await pool.query<WorkoutDetailSet>(
    `SELECT s.id, s.exercise_id, e.name AS exercise_name, s.set_number, s.reps, s.weight, s.unit
     FROM sets s
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = $1
     ORDER BY s.set_number ASC`,
    [workout.id]
  );

  // Spread copies the workout's fields into a new object, then sets is added alongside them.
  return { ...workout, sets: setsResult.rows };
}
