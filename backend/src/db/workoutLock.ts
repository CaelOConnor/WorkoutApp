import type { PoolClient } from 'pg';

// Locks a workout until the transaction ends, so changes to its set numbers happen one at a time.
// Without it, two requests could both read "highest set is 3" and both save set 4.
// Call it first, inside withTransaction, when adding, deleting or removing sets.
// Also checks ownership: returns false for someone else's workout or a missing one.
export async function lockWorkout(client: PoolClient, workoutId: number, userId: number): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM workouts WHERE id = $1 AND user_id = $2 FOR UPDATE', [
    workoutId,
    userId,
  ]);
  return result.rowCount === 1;
}