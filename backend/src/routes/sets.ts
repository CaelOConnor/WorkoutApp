import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import { isUnknownExerciseError } from '../db/errors';
import { withTransaction } from '../db/transaction';
import { loadWorkoutDetail } from '../db/workoutDetail';
import { addWorkoutExercise, removeWorkoutExerciseIfEmpty } from '../db/workoutExercises';
import { lockWorkout } from '../db/workoutLock';
import { getAuthUser } from '../middleware/auth';
import { isNewSetInput, isUpdateSetBody, parseId, UPDATE_SET_KEYS } from '../validation';
import type { ErrorResponse, WorkoutDetail, WorkoutSet } from '../types/models';

// Mounted at /workouts/:id/sets, behind requireAuth.
// mergeParams lets this router read the parent's :id, not just its own :setId.
// Set numbers stay 1, 2, 3... with no gaps. Adding and deleting lock the workout first.
const setsRouter = Router({ mergeParams: true });

type SetParams = { id: string; setId: string };

setsRouter.post(
  '/',
  async (
    req: Request<{ id: string }, WorkoutDetail | ErrorResponse, unknown>,
    res: Response<WorkoutDetail | ErrorResponse>
  ) => {
    const workoutId = parseId(req.params.id);
    if (workoutId === null) {
      return res.status(400).json({ error: 'Invalid workout id' });
    }
    if (!isNewSetInput(req.body)) {
      return res.status(400).json({ error: 'Invalid set body' });
    }
    const { exercise_id, reps, weight, unit } = req.body;
    const user = getAuthUser(req);

    try {
      const found = await withTransaction(async (client) => {
        // Ownership is checked before the exercise, so another user's workout
        // always gets a 404 and never reveals that it exists.
        if (!(await lockWorkout(client, workoutId, user.id))) {
          return false;
        }
        await addWorkoutExercise(client, workoutId, exercise_id);
        // The new set goes after the exercise's last one. COALESCE makes the first set 1.
        await client.query(
          `INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight, unit)
           SELECT $1, $2, COALESCE(MAX(set_number), 0) + 1, $3, $4, $5
           FROM sets
           WHERE workout_id = $1 AND exercise_id = $2`,
          [workoutId, exercise_id, reps, weight, unit ?? 'lb']
        );
        return true;
      });
      if (!found) {
        return res.status(404).json({ error: 'Workout not found' });
      }
    } catch (err: unknown) {
      if (isUnknownExerciseError(err)) {
        return res.status(400).json({ error: 'Unknown exercise_id' });
      }
      throw err;
    }

    const workout = await loadWorkoutDetail(workoutId, user.id);
    if (!workout) {
      return res.status(404).json({ error: 'Workout not found' }); // deleted in between
    }
    return res.status(201).json(workout);
  }
);

// Edits reps, weight or unit. Set numbers don't change, so no lock is needed.
setsRouter.patch(
  '/:setId',
  async (
    req: Request<SetParams, WorkoutDetail | ErrorResponse, unknown>,
    res: Response<WorkoutDetail | ErrorResponse>
  ) => {
    const workoutId = parseId(req.params.id);
    if (workoutId === null) {
      return res.status(400).json({ error: 'Invalid workout id' });
    }
    const setId = parseId(req.params.setId);
    if (setId === null) {
      return res.status(400).json({ error: 'Invalid set id' });
    }
    if (!isUpdateSetBody(req.body)) {
      return res.status(400).json({ error: 'Invalid set body' });
    }
    const body = req.body;

    // Only update the fields that were sent, same as PATCH /workouts/:id.
    const assignments: string[] = [];
    const values: (number | string)[] = [];
    for (const column of UPDATE_SET_KEYS) {
      const value = body[column];
      if (value !== undefined) {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    const user = getAuthUser(req);
    // Joins in the workout, since that's where the owner is stored.
    // Only matches if the set is in this workout and the workout is this user's.
    const n = values.length;
    const updateResult = await pool.query(
      `UPDATE sets s SET ${assignments.join(', ')}
       FROM workouts w
       WHERE s.id = $${n + 1} AND s.workout_id = $${n + 2}
         AND w.id = s.workout_id AND w.user_id = $${n + 3}`,
      [...values, setId, workoutId, user.id]
    );
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Set not found' });
    }

    const workout = await loadWorkoutDetail(workoutId, user.id);
    if (!workout) {
      return res.status(404).json({ error: 'Workout not found' }); // deleted in between
    }
    return res.json(workout);
  }
);

setsRouter.delete(
  '/:setId',
  async (req: Request<SetParams>, res: Response<ErrorResponse>) => {
    const workoutId = parseId(req.params.id);
    if (workoutId === null) {
      return res.status(400).json({ error: 'Invalid workout id' });
    }
    const setId = parseId(req.params.setId);
    if (setId === null) {
      return res.status(400).json({ error: 'Invalid set id' });
    }
    const user = getAuthUser(req);

    const deleted = await withTransaction(async (client) => {
      if (!(await lockWorkout(client, workoutId, user.id))) {
        return false;
      }
      // RETURNING gives back the deleted set's exercise and number, for closing the gap.
      const result = await client.query<Pick<WorkoutSet, 'exercise_id' | 'set_number'>>(
        'DELETE FROM sets WHERE id = $1 AND workout_id = $2 RETURNING exercise_id, set_number',
        [setId, workoutId]
      );
      const set = result.rows[0];
      if (!set) {
        return false;
      }
      // Move the exercise's later sets down one, so 1, 3, 4 becomes 1, 2, 3.
      // The unique rule is DEFERRABLE, so it's checked after the whole update, not row by row.
      await client.query(
        `UPDATE sets SET set_number = set_number - 1
         WHERE workout_id = $1 AND exercise_id = $2 AND set_number > $3`,
        [workoutId, set.exercise_id, set.set_number]
      );
      // If that was the exercise's last set, remove the exercise from the workout.
      await removeWorkoutExerciseIfEmpty(client, workoutId, set.exercise_id);
      return true;
    });

    if (!deleted) {
      return res.status(404).json({ error: 'Set not found' });
    }
    return res.status(204).end();
  }
);

export default setsRouter;