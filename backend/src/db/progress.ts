import pool from './pool';
import type {
  Exercise,
  ExerciseLastSets,
  LoggedExercise,
  ProgressPoint,
  ProgressQuery,
  WeightUnit,
} from '../types/models';

// Progress counts only sets with 1+ reps. A 0-rep set is a failed attempt or the app's 0 × 0
// placeholder: it adds nothing to volume, and it mustn't become the heaviest set or decide the unit.
// "Most recent" is the latest workout date, then the latest workout and set on that date.

// The exercise if the user may see it (built-in, or their own custom one), else null. Another
// user's custom exercise gets the same null as a missing id, so a 404 reveals nothing.
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

// The unit of the user's most recent set (with reps) of an exercise, or null if there is none.
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

// One point per workout date, oldest first, every weight converted to `unit` before aggregating
// (otherwise MAX would compare 100 kg with 200 lb as plain numbers).
// - The CTE (WITH ... AS) converts each set once, so the outer query only aggregates.
// - 0.45359237 is the exact definition of a pound in kg.
// - ROUND, SUM, and NUMERIC arithmetic return NUMERIC, which db/pool.ts parses to a number.
// - COUNT returns BIGINT, which pg leaves as a string (it can pass 2^53), so it's cast to int.
// - $4::date IS NULL makes a missing from/to match every row, so one query covers all four cases.
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
            -- Epley; a single is its own weight (the formula would add 1/30).
            ROUND(MAX(CASE WHEN reps = 1 THEN weight ELSE weight * (1 + reps / 30.0) END), 1) AS e1rm,
            ROUND(SUM(weight * reps), 1) AS volume,
            COUNT(*)::int AS sets
     FROM converted
     GROUP BY date
     ORDER BY date`,
    [exerciseId, userId, unit, from ?? null, to ?? null]
  );
  return result.rows;
}

// Every exercise the user has a set (with reps) of, with that most recent set's date and unit.
// DISTINCT ON (e.id) is Postgres-only: it keeps the first row of each e.id group, in the
// subquery's ORDER BY order, i.e. the most recent set. That ORDER BY must start with e.id, so
// the list is sorted again outside: most recent first, then by name.
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

// For each exercise id the user has logged, the 1+ rep sets from their most recent workout with
// one, in the order the ids are given (see ExerciseLastSets). Two steps in one query:
// - latest: DISTINCT ON picks one workout per exercise, the first in ORDER BY order, i.e. the
//   latest date, then the workout logged last. Only 1+ rep sets are looked at, so a workout with
//   just the 0 x 0 placeholder of that exercise doesn't count as "last time".
// - then that workout's 1+ rep sets of the exercise, by set_number.
// Filtering on w.user_id means only the caller's own sets count, so another user's custom
// exercise id finds nothing, the same as one never logged.
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
  // Back in the caller's order. flatMap with [] for a missing entry drops it, which also narrows
  // `ExerciseLastSets | undefined` to ExerciseLastSets without a cast.
  return exerciseIds.flatMap((id) => {
    const entry = byExercise.get(id);
    return entry ? [entry] : [];
  });
}
