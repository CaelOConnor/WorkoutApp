import { DatabaseError } from 'pg';

// Database rules that reject a bad exercise_id: the foreign keys (no such exercise)
// and the visibility triggers (another user's custom exercise).
const UNKNOWN_EXERCISE_CONSTRAINTS = [
  'sets_exercise_id_fkey',
  'workout_exercises_exercise_id_fkey',
  'sets_exercise_visible',
  'template_exercises_exercise_id_fkey',
  'template_exercises_exercise_visible',
];

// True when a write pointed at an exercise that doesn't exist or the user can't see.
// 23503 is a foreign key violation. The constraint name is checked too, because other
// 23503 errors (like a missing user) are our fault, not the client's.
export function isUnknownExerciseError(err: unknown): boolean {
  return (
    err instanceof DatabaseError &&
    err.code === '23503' &&
    err.constraint !== undefined &&
    UNKNOWN_EXERCISE_CONSTRAINTS.includes(err.constraint)
  );
}

// True when an insert broke the given unique rule. 23505 is a unique violation.
export function isUniqueViolation(err: unknown, constraint: string): boolean {
  return err instanceof DatabaseError && err.code === '23505' && err.constraint === constraint;
}