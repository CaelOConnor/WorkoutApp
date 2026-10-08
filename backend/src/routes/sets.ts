import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import { isUnknownExerciseError } from '../db/errors';
import { loadWorkoutDetail } from '../db/workoutDetail';
import { getAuthUser } from '../middleware/auth';
import { isUpdateSetBody, parseId, UPDATE_SET_KEYS } from '../validation';
import type { ErrorResponse, WorkoutDetail } from '../types/models';

// Mounted by workoutsRouter at '/:id/sets', so '/:setId' here is /workouts/:id/sets/:setId.
// It sits under workoutsRouter, so requireAuth has already run for every route here.
// mergeParams: by default a router only sees the params in its own paths (:setId). This option
// also gives it the parent's :id. Express's types can't see that option, so SetParams declares
// both by hand.
const setsRouter = Router({ mergeParams: true });

type SetParams = { id: string; setId: string };

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

    // Same idea as PATCH /workouts/:id: only sent fields go into SET, column names come from
    // the code's allowlist, and every value goes through a $n placeholder.
    const assignments: string[] = [];
    const values: (number | string)[] = [];
    for (const column of UPDATE_SET_KEYS) {
      // `column` is the union 'exercise_id' | 'set_number' | ..., so body[column] type-checks
      // as number | WeightUnit | undefined. With a plain string it would be an error.
      const value = body[column];
      if (value !== undefined) {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    const user = getAuthUser(req);
    try {
      // UPDATE ... FROM joins in the workouts table, so a set only matches if it's this id,
      // in the workout named in the URL, and that workout is the user's. Any mismatch matches
      // no row, which gives one 404 for all of them.
      // (SET can't qualify columns with the alias: it's `reps = ...`, not `s.reps = ...`.)
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
    } catch (err: unknown) {
      // The FK is only checked on rows the UPDATE actually changes, so a set the user can't
      // see gets its 404 above and never reaches this 400, which would reveal that it exists.
      if (isUnknownExerciseError(err)) {
        return res.status(400).json({ error: 'Unknown exercise_id' });
      }
      // Anything else is our problem: rethrow, and Express 5 hands it to the error handler (500).
      throw err;
    }

    const workout = await loadWorkoutDetail(workoutId, user.id);
    if (!workout) {
      // Only possible if the workout was deleted between the two queries.
      return res.status(404).json({ error: 'Workout not found' });
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
    // DELETE ... USING is Postgres's way to join another table into a DELETE, like UPDATE ... FROM
    // above, and with the same three-way match. The workout itself is left alone, even if this
    // was its last set.
    const result = await pool.query(
      `DELETE FROM sets s
       USING workouts w
       WHERE s.id = $1 AND s.workout_id = $2
         AND w.id = s.workout_id AND w.user_id = $3`,
      [setId, workoutId, user.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Set not found' });
    }
    return res.status(204).end();
  }
);

export default setsRouter;
