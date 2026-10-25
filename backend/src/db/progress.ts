import pool from './pool';
import type {
  Exercise,
  ExerciseLastSets,
  LoggedExercise,
  ProgressPoint,
  ProgressQuery,
  WeightUnit,
} from '../types/models';

// Queries for the progress chart and the "last time" hints.
// Only sets with 1+ reps count. A 0-rep set is a placeholder or a failed attempt,
// so it shouldn't count as the heaviest set, add to volume, or decide the unit.

// The exercise if the user can see it (built-in or their own), otherwise null.
export async function findVisibleExercise(
  exerciseId: number,
  userId: number
): Promise<Pick<Exercise, 'id' | 'name'> | null> {
  const result = await pool.query<Pick<Exercise, 'id' | 'name'>>(
    'SELECT id, name FROM exercises WHERE id = $1 AND (created_by IS NULL OR created_by = $2)',
    [exerciseId, userId]
  );
  return result.rows[0] ?? null;
}

// The unit of the user's most recent set of this exercise, or null if they've never logged it.
export async function latestUnit(exerciseId: number, userId: number): Promise<WeightUnit | null> {
  const result = await pool.query<{ unit: WeightUnit }>(
    `SELECT s.unit
     FROM sets s
     JOIN workouts w ON w.id = s.workout_id
     WHERE s.exercise_id = $1 AND w.user_id = $2 AND s.reps > 0
     ORDER BY w.date DESC, w.id DESC, s.id DESC
     LIMIT 1`,
    [exerciseId, userId]
  );
  return result.rows[0]?.unit ?? null;
}

// One chart point per workout date, oldest first.
// First converts every set to the same unit, otherwise MAX would compare kg and lb as plain numbers.
// 0.45359237 is the exact number of kg in a pound.
// A missing from/to (NULL) matches every date, so one query covers all date ranges.
// COUNT comes back as a string from pg, so it's cast to int.
export async function loadProgressPoints(
  exerciseId: number,
  userId: number,
  unit: WeightUnit,
  { from, to }: Pick<ProgressQuery, 'from' | 'to'>
): Promise<ProgressPoint[]> {
  const result = await pool.query<ProgressPoint>(
    `WITH converted AS (
       SELECT w.date, s.reps,
              CASE
                WHEN s.unit = $3::text THEN s.weight
                WHEN $3::text = 'kg' THEN s.weight * 0.45359237
                ELSE s.weight / 0.45359237
              END AS weight
       FROM sets s
       JOIN workouts w ON w.id = s.workout_id
       WHERE s.exercise_id = $1 AND w.user_id = $2 AND s.reps > 0
         AND ($4::date IS NULL OR w.date >= $4::date)
         AND ($5::date IS NULL OR w.date <= $5::date)
     )
     SELECT date,
            ROUND(MAX(weight), 1) AS top_weight,
            ROUND(SUM(weight * reps), 1) AS volume,
            COUNT(*)::int AS sets
     FROM converted
     GROUP BY date
     ORDER BY date`,
    [exerciseId, userId, unit, from ?? null, to ?? null]
  );
  return result.rows;
}

// Every exercise the user has logged, with the date and unit of its most recent set.
// DISTINCT ON keeps the first row per exercise, which is the most recent because of the ORDER BY.
// Then the list is re-sorted: most recently logged first, then by name.
export async function listLoggedExercises(userId: number): Promise<LoggedExercise[]> {
  const result = await pool.query<LoggedExercise>(
    `SELECT id, name, last_date, unit
     FROM (
       SELECT DISTINCT ON (e.id) e.id, e.name, w.date AS last_date, s.unit
       FROM sets s
       JOIN workouts w ON w.id = s.workout_id
       JOIN exercises e ON e.id = s.exercise_id
       WHERE w.user_id = $1 AND s.reps > 0 AND (e.created_by IS NULL OR e.created_by = $1)
       ORDER BY e.id, w.date DESC, w.id DESC, s.id DESC
     ) latest
     ORDER BY last_date DESC, name, id`,
    [userId]
  );
  return result.rows;
}

// For the grey hints: each exercise's sets from the last workout it was done in.
// latest finds that workout per exercise (DISTINCT ON again), then its sets are loaded in order.
// Only the user's own sets count, so exercises they've never logged are left out.
export async function loadLastSets(exerciseIds: number[], userId: number): Promise<ExerciseLastSets[]> {
  const result = await pool.query<{ exercise_id: number; date: string } & ExerciseLastSets['sets'][number]>(
    `WITH latest AS (
       SELECT DISTINCT ON (s.exercise_id) s.exercise_id, w.id AS workout_id, w.date
       FROM sets s
       JOIN workouts w ON w.id = s.workout_id
       WHERE w.user_id = $1 AND s.exercise_id = ANY($2::int[]) AND s.reps > 0
       ORDER BY s.exercise_id, w.date DESC, w.id DESC
     )
     SELECT l.exercise_id, l.date, s.reps, s.weight, s.unit
     FROM latest l
     JOIN sets s ON s.workout_id = l.workout_id AND s.exercise_id = l.exercise_id
     WHERE s.reps > 0
     ORDER BY l.exercise_id, s.set_number`,
    [userId, exerciseIds]
  );

  const byExercise = new Map<number, ExerciseLastSets>();
  for (const { exercise_id, date, ...set } of result.rows) {
    const entry = byExercise.get(exercise_id) ?? { exercise_id, date, sets: [] };
    entry.sets.push(set);
    byExercise.set(exercise_id, entry);
  }
  // Back in the order the app asked for, skipping exercises never logged.
  return exerciseIds.flatMap((id) => {
    const entry = byExercise.get(id);
    return entry ? [entry] : [];
  });
}