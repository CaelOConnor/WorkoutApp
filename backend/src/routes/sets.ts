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

// Mounted by workoutsRouter at '/:id/sets', so '/:setId' here is /workouts/:id/sets/:setId.
// It sits under workoutsRouter, so requireAuth has already run for every route here.
// mergeParams: by default a router only sees the params in its own paths (:setId). This option
// also gives it the parent's :id. Express's types can't see that option, so SetParams declares
// both by hand.
//
// set_number is each set's position within its exercise in the workout (1..n, no gaps). The
// server keeps it that way: an added set goes after its exercise's last one, and deleting a set
// moves the later ones down. Both lock the workout first (see db/workoutLock.ts).
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
    if (!isNewSetInput(req.body)) {
      return res.status(400).json({ error: 'Invalid set body' });
    }
    const { exercise_id, reps, weight, unit } = req.body;
    const user = getAuthUser(req);

    try {
      const found = await withTransaction(async (client) => {
        // A missing or someone else's workout stops here, before the insert, so the exercise is
        // never checked for it and an intruder can't get a 400 that would reveal the workout exists.
        if (!(await lockWorkout(client, workoutId, user.id))) {
          return false;
        }
        // An exercise new to the workout goes after its other exercises; one already in it keeps
        // its place. (Another user's custom exercise is rejected here, as a 400 below.)
        await addWorkoutExercise(client, workoutId, exercise_id);
        // The new set's number: this exercise's highest in the workout + 1. An aggregate with no
        // GROUP BY always gives exactly one row, even over no sets, where MAX is NULL; COALESCE
        // turns that into 0, so an exercise's first set is 1.
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
      // Only possible if the workout was deleted between the two queries.
      return res.status(404).json({ error: 'Workout not found' });
    }
    return res.status(201).json(workout);
  }
);

// Edits a set's reps, weight or unit. Its exercise and number can't change here, so it doesn't
// affect any other set and needs no lock.
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
      // `column` is the union 'reps' | 'weight' | 'unit', so body[column] type-checks as
      // number | WeightUnit | undefined. With a plain string it would be an error.
      const value = body[column];
      if (value !== undefined) {
        values.push(value);
        assignments.push(`${column} = $${values.length}`);
      }
    }

    const user = getAuthUser(req);
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

    const deleted = await withTransaction(async (client) => {
      // The lock checks the workout is the user's; the DELETE then checks the set is in it.
      // Either failing gives the same 404. The workout itself stays, even if this was its last set.
      if (!(await lockWorkout(client, workoutId, user.id))) {
        return false;
      }
      // RETURNING hands back columns of the deleted row, so the shift below knows where it was.
      const result = await client.query<Pick<WorkoutSet, 'exercise_id' | 'set_number'>>(
        'DELETE FROM sets WHERE id = $1 AND workout_id = $2 RETURNING exercise_id, set_number',
        [setId, workoutId]
      );
      const set = result.rows[0];
      if (!set) {
        return false;
      }
      // Close the gap: the exercise's later sets each move down one (Squat 1, 3, 4 -> 1, 2, 3).
      // The unique constraint is DEFERRABLE, so it's checked after this whole statement rather
      // than after each row, when a row can briefly share a number with one that hasn't moved yet.
      await client.query(
        `UPDATE sets SET set_number = set_number - 1
         WHERE workout_id = $1 AND exercise_id = $2 AND set_number > $3`,
        [workoutId, set.exercise_id, set.set_number]
      );
      // If that was the exercise's last set, it leaves the workout too.
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
