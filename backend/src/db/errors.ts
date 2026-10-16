import { DatabaseError } from 'pg';

// The constraints that reject a set's exercise_id: the foreign key (no such exercise), and the
// sets_exercise_visible trigger (another user's custom exercise; see the custom-exercises migration).
const UNKNOWN_EXERCISE_CONSTRAINTS = ['sets_exercise_id_fkey', 'sets_exercise_visible'];

// True when a write failed because a set pointed at an exercise that doesn't exist, or that the
// workout's owner can't see. 23503 = foreign_key_violation. The constraint name is matched too,
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
