import pool from './pool';
import type { Workout, WorkoutDetail, WorkoutDetailSet } from '../types/models';

type WorkoutColumns = Pick<Workout, 'id' | 'date' | 'notes'>;

// Fetches the sets for every given workout in one query and nests them, so loading N workouts
// costs 2 queries in total rather than 1 + N. Each workout keeps its position in the input array.
async function attachSets(workouts: WorkoutColumns[]): Promise<WorkoutDetail[]> {
  if (workouts.length === 0) {
    return [];
  }
  // pg sends a JS array as a Postgres array, and `= ANY($1)` matches any element of it, so one
  // placeholder covers every id. The ::int[] cast tells Postgres the array's element type.
  // workout_id is selected only for grouping below; it's stripped before the set is returned.
  const setsResult = await pool.query<WorkoutDetailSet & { workout_id: number }>(
    `SELECT s.workout_id, s.id, s.exercise_id, e.name AS exercise_name, s.set_number, s.reps, s.weight, s.unit
     FROM sets s
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = ANY($1::int[])
     ORDER BY s.set_number ASC, s.id ASC`,
    [workouts.map((w) => w.id)]
  );

  // Map from workout id to its sets. Rows arrive sorted by set_number, and push keeps that order.
  const setsByWorkout = new Map<number, WorkoutDetailSet[]>();
  for (const { workout_id, ...set } of setsResult.rows) {
    // Rest syntax (...set) collects every field except workout_id into a new object.
    const list = setsByWorkout.get(workout_id) ?? [];
    list.push(set);
    setsByWorkout.set(workout_id, list);
  }

  // A workout with no sets has no Map entry, so `?? []` gives it an empty list.
  return workouts.map((workout) => ({ ...workout, sets: setsByWorkout.get(workout.id) ?? [] }));
}

// One workout with its sets nested, or null if it doesn't exist or belongs to someone else.
// Filtering on user_id in SQL means another user's workout simply isn't found, so callers give
// it the same 404 as a missing id and the response can't reveal that it exists.
// Lives here rather than in a router because both the workouts and sets routers return it.
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
  // Destructuring gives `WorkoutDetail | undefined` (noUncheckedIndexedAccess), though one in
  // means one out.
  return detail ?? null;
}

// All of a user's workouts with their sets nested, newest date first. Workouts on the same date
// put the higher id (created later) first, so the order is stable between requests.
export async function listWorkoutDetails(userId: number): Promise<WorkoutDetail[]> {
  const workoutsResult = await pool.query<WorkoutColumns>(
    'SELECT id, date, notes FROM workouts WHERE user_id = $1 ORDER BY date DESC, id DESC',
    [userId]
  );
  return attachSets(workoutsResult.rows);
}
