import { DatabaseError } from 'pg';

// True when a write failed because a set pointed at an exercise that doesn't exist.
// 23503 = foreign_key_violation. The constraint name is matched too, because a missing
// user (workouts.user_id) is also 23503 and isn't the client's fault.
// Takes `unknown` because that's what a catch block hands you; instanceof narrows it.
export function isUnknownExerciseError(err: unknown): boolean {
  return (
    err instanceof DatabaseError &&
    err.code === '23503' &&
    err.constraint === 'sets_exercise_id_fkey'
  );
}
