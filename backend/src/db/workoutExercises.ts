import type { PoolClient } from 'pg';

// Stores each exercise's position in a workout, so the cards keep their order.
// Every exercise with sets must have a row here. A row is added with an exercise's
// first set and removed with its last.
// Use inside the transaction holding the workout lock, so two requests can't pick the same position.

// Adds the exercise at the end of the workout, unless it's already there.
// COALESCE turns "no exercises yet" (NULL) into 0, so the first one gets position 1.
export async function addWorkoutExercise(client: PoolClient, workoutId: number, exerciseId: number): Promise<void> {
  await client.query(
    `INSERT INTO workout_exercises (workout_id, exercise_id, position)
     SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM workout_exercises WHERE workout_id = $1
     ON CONFLICT (workout_id, exercise_id) DO NOTHING`,
    [workoutId, exerciseId]
  );
}

// Removes the exercise from the workout once its last set is gone.
// Adding it again later puts it at the end, like a new exercise.
export async function removeWorkoutExerciseIfEmpty(
  client: PoolClient,
  workoutId: number,
  exerciseId: number
): Promise<void> {
  await client.query(
    `DELETE FROM workout_exercises we
     WHERE we.workout_id = $1 AND we.exercise_id = $2
       AND NOT EXISTS (SELECT 1 FROM sets s WHERE s.workout_id = $1 AND s.exercise_id = $2)`,
    [workoutId, exerciseId]
  );
}