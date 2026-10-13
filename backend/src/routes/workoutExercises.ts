import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import { loadWorkoutDetail } from '../db/workoutDetail';
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

    // One statement, so the sets go all together or not at all. USING joins in workouts for the
    // ownership check, like DELETE .../sets/:setId: another user's workout matches no rows.
    const result = await pool.query(
      `DELETE FROM sets s
       USING workouts w
       WHERE s.workout_id = $1 AND s.exercise_id = $2
         AND w.id = s.workout_id AND w.user_id = $3`,
      [workoutId, exerciseId, user.id]
    );

    // Loaded either way: it's the response on success, and on a 0-row delete it tells the two
    // 404s apart. It only finds this user's workouts, so someone else's workout gets the same
    // 'Workout not found' as a missing one, and the more specific message reveals nothing.
    const workout = await loadWorkoutDetail(workoutId, user.id);
    if (!workout) {
      return res.status(404).json({ error: 'Workout not found' });
    }
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Exercise not in this workout' });
    }
    return res.json(workout);
  }
);

export default workoutExercisesRouter;
