import { Router, type Request, type Response } from 'express';
import { withTransaction } from '../db/transaction';
import { loadWorkoutDetail } from '../db/workoutDetail';
import { lockWorkout } from '../db/workoutLock';
import { getAuthUser } from '../middleware/auth';
import { parseId } from '../validation';
import type { ErrorResponse, WorkoutDetail } from '../types/models';

// Mounted by workoutsRouter at '/:id/exercises', so '/:exerciseId' here is
// /workouts/:id/exercises/:exerciseId. requireAuth has already run. A workout has no list of
// exercises of its own: "the exercises in a workout" are just the exercise_ids of its sets.
// mergeParams gives this router the parent's :id (see sets.ts).
const workoutExercisesRouter = Router({ mergeParams: true });

type ExerciseParams = { id: string; exerciseId: string };

// Removes every set of one exercise from a workout ("Remove exercise" in the app).
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

    // A union of string literals names each outcome, and TypeScript checks every comparison
    // below against exactly these three (a typo like 'no set' is a compile error).
    type Outcome = 'no workout' | 'no sets' | 'removed';
    const outcome = await withTransaction(async (client): Promise<Outcome> => {
      // Locked like adding or deleting a set (see db/workoutLock.ts): a set of this exercise
      // added at the same moment would otherwise be numbered after sets that are being removed.
      // The lock only finds this user's workouts, so someone else's gets the same 'Workout not
      // found' as a missing one, and the more specific message below reveals nothing.
      if (!(await lockWorkout(client, workoutId, user.id))) {
        return 'no workout';
      }
      // One statement, so the sets go all together or not at all. No renumbering: the other
      // exercises' numbers never counted this one's sets.
      const result = await client.query('DELETE FROM sets WHERE workout_id = $1 AND exercise_id = $2', [
        workoutId,
        exerciseId,
      ]);
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
      // Only possible if the workout was deleted between the two queries.
      return res.status(404).json({ error: 'Workout not found' });
    }
    return res.json(workout);
  }
);

export default workoutExercisesRouter;
