import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import { isOutOfRangeError, isUnknownExerciseError } from '../db/errors';
import { loadWorkoutDetail } from '../db/workoutDetail';
import { getAuthUser } from '../middleware/auth';
import { isAddSetBody, isUpdateSetBody, parseId, UPDATE_SET_KEYS } from '../validation';
import type { ErrorResponse, WorkoutDetail } from '../types/models';

// Mounted by workoutsRouter at '/:id/sets', so '/:setId' here is /workouts/:id/sets/:setId.
// It sits under workoutsRouter, so requireAuth has already run for every route here.
// mergeParams: by default a router only sees the params in its own paths (:setId). This option
// also gives it the parent's :id. Express's types can't see that option, so SetParams declares
// both by hand.
const setsRouter = Router({ mergeParams: true });

type SetParams = { id: string; setId: string };

// '/' here is /workouts/:id/sets. Only the parent's :id is in the path, hence { id: string }.
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
    if (!isAddSetBody(req.body)) {
      return res.status(400).json({ error: 'Invalid set body' });
    }
    const { exercise_id, set_number, reps, weight, unit } = req.body;
    const user = getAuthUser(req);

    try {
      // INSERT ... SELECT inserts one row per row the SELECT finds. The SELECT finds the workout
      // only if it's this id and this user's, so a missing or someone else's workout inserts
      // nothing (rowCount 0, a 404), and the exercise FK is never checked for it, so an intruder
      // can't get a 400 that would reveal the workout exists.
      // set_number: the one sent, else this workout's highest + 1, else 1 (MAX of no rows is
      // NULL, and NULL + 1 is NULL, so COALESCE falls through to 1 for an empty workout).
      // ::int tells Postgres what type $2 is, since it could be NULL.
      // Not safe against two adds at once: both can read the same MAX (see ROADMAP.md).
      const insertResult = await pool.query(
        `INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight, unit)
         SELECT w.id, $1, COALESCE($2::int, (SELECT MAX(s.set_number) + 1 FROM sets s WHERE s.workout_id = w.id), 1), $3, $4, $5
         FROM workouts w
         WHERE w.id = $6 AND w.user_id = $7`,
        // `?? null`: pg sends JS null as SQL NULL; undefined isn't a value it accepts.
        [exercise_id, set_number ?? null, reps, weight, unit ?? 'lb', workoutId, user.id]
      );
      if (insertResult.rowCount === 0) {
        return res.status(404).json({ error: 'Workout not found' });
      }
    } catch (err: unknown) {
      if (isUnknownExerciseError(err)) {
        return res.status(400).json({ error: 'Unknown exercise_id' });
      }
      // The body was range-checked, so only MAX + 1 can overflow: the workout's highest
      // set_number is already the INTEGER max. A conflict with the workout's state, not a bad body.
      if (isOutOfRangeError(err)) {
        return res.status(409).json({ error: 'No set_number left after the highest one in this workout' });
      }
      throw err;
    }

    const workout = await loadWorkoutDetail(workoutId, user.id);
    if (!workout) {
      // Only possible if the workout was deleted between the two queries.
      return res.status(404).json({ error: 'Workout not found' });
    }
    return res.status(201).json(workout);
  }
);

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
