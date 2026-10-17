import { DatabaseError } from 'pg';

// The constraints that reject an exercise_id: the foreign keys (no such exercise) on sets,
// workout_exercises (written before an exercise's first set) and template_exercises, and the
// visibility triggers (another user's custom exercise; see the custom-exercises,
// workout-exercises and templates migrations).
const UNKNOWN_EXERCISE_CONSTRAINTS = [
  'sets_exercise_id_fkey',
  'workout_exercises_exercise_id_fkey',
  'sets_exercise_visible',
  'template_exercises_exercise_id_fkey',
  'template_exercises_exercise_visible',
];

// True when a write failed because a set or template pointed at an exercise that doesn't exist,
// or that the workout's or template's owner can't see. 23503 = foreign_key_violation. The constraint name is matched too,
// because a missing user (workouts.user_id) is also 23503 and isn't the client's fault.
// Takes `unknown` because that's what a catch block hands you; instanceof narrows it.
// err.constraint is `string | undefined`, so the `!== undefined` check comes before includes().
export function isUnknownExerciseError(err: unknown): boolean {
  return (
    err instanceof DatabaseError &&
    err.code === '23503' &&
    err.constraint !== undefined &&
    UNKNOWN_EXERCISE_CONSTRAINTS.includes(err.constraint)
  );
}

// True when an insert broke a unique index. 23505 = unique_violation.
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  return err instanceof DatabaseError && err.code === '23505' && err.constraint === constraint;
}
