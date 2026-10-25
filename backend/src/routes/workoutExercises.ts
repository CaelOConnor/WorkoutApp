import { Router, type Request, type Response } from 'express';
import { withTransaction } from '../db/transaction';
import { loadWorkoutDetail } from '../db/workoutDetail';
import { lockWorkout } from '../db/workoutLock';
import { getAuthUser } from '../middleware/auth';
import { parseId } from '../validation';
import type { ErrorResponse, WorkoutDetail } from '../types/models';

// Mounted at /workouts/:id/exercises, behind requireAuth. mergeParams gives it the parent's :id.
const workoutExercisesRouter = Router({ mergeParams: true });

type ExerciseParams = { id: string; exerciseId: string };

// "Remove exercise" in the app: deletes all of one exercise's sets from a workout.
workoutExercisesRouter.delete(
  '/:exerciseId',
  async (
    req: Request<ExerciseParams>,
    res: Response<WorkoutDetail | ErrorResponse>
  ) => {
    const workoutId = parseId(req.params.id);
    if (workoutId === null) {
      return res.status(400).json({ error: 'Invalid workout id' });
    }
    const exerciseId = parseId(req.params.exerciseId);
    if (exerciseId === null) {
      return res.status(400).json({ error: 'Invalid exercise id' });
    }
    const user = getAuthUser(req);

    // Three possible results, so named strings instead of true/false.
    type Outcome = 'no workout' | 'no sets' | 'removed';
    const outcome = await withTransaction(async (client): Promise<Outcome> => {
      // Locked so a set added at the same moment can't interleave with the removal.
      if (!(await lockWorkout(client, workoutId, user.id))) {
        return 'no workout';
      }
      // Deleting the exercise from the workout deletes its sets too (cascade).
      // No renumbering needed: other exercises' set numbers don't depend on this one.
      const result = await client.query(
        'DELETE FROM workout_exercises WHERE workout_id = $1 AND exercise_id = $2',
        [workoutId, exerciseId]
      );
      return result.rowCount === 0 ? 'no sets' : 'removed';
    });

    if (outcome === 'no workout') {
      return res.status(404).json({ error: 'Workout not found' });
    }
    if (outcome === 'no sets') {
      return res.status(404).json({ error: 'Exercise not in this workout' });
    }
    const workout = await loadWorkoutDetail(workoutId, user.id);
    if (!workout) {
      return res.status(404).json({ error: 'Workout not found' }); // deleted in between
    }
    return res.json(workout);
  }
);

export default workoutExercisesRouter;