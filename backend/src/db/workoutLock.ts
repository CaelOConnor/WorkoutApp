import type { PoolClient } from 'pg';

// Locks one of the user's workouts until the client's transaction ends, and says whether it was
// found. Call it first, inside withTransaction, in every write that changes a workout's set
// numbers (adding a set, deleting one, removing an exercise).
//
// Why: set numbers are computed from the sets already there (the highest + 1, or shifting the
// later ones down). Two such writes at once could both read the same sets and save a duplicate
// or leave a gap. FOR UPDATE makes a second transaction that asks for the same row wait until
// the first commits. Under Postgres's default READ COMMITTED level, each statement after that sees
// the data as of when it starts, so the waiting write then sees the first one's changes.
//
// It's also the ownership check: someone else's workout, or a missing one, locks nothing and
// returns false, which callers turn into a 404 before touching any set.
export async function lockWorkout(client: PoolClient, workoutId: number, userId: number): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM workouts WHERE id = $1 AND user_id = $2 FOR UPDATE', [
    workoutId,
    userId,
  ]);
  return result.rowCount === 1;
}
