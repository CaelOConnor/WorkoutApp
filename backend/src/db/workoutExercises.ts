import type { PoolClient } from 'pg';

// A workout's exercises live in workout_exercises, with a stored position that orders the cards.
// Every set's (workout, exercise) must have a row there (sets_workout_exercise_fkey), and the
// routes keep the two in step: a row appears with an exercise's first set and goes with its last.
// Call these inside the transaction that holds the workout lock (see workoutLock.ts), which keeps
// two writes from picking the same next position.

// Adds the exercise to the workout, after its other exercises, unless it's already there.
// MAX over no rows is NULL, and COALESCE makes the first exercise position 1. ON CONFLICT on the
// primary key turns "already in the workout" into doing nothing instead of an error.
export async function addWorkoutExercise(client: PoolClient, workoutId: number, exerciseId: number): Promise<void> {
  await client.query(
    `INSERT INTO workout_exercises (workout_id, exercise_id, position)
     SELECT $1, $2, COALESCE(MAX(position), 0) + 1 FROM workout_exercises WHERE workout_id = $1
     ON CONFLICT (workout_id, exercise_id) DO NOTHING`,
    [workoutId, exerciseId]
  );
}

// Takes the exercise out of the workout if it has no sets left, so adding it again later puts it
// at the end, like any exercise new to the workout (the app has no card for one without sets).
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
