import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import { isUniqueViolation } from '../db/errors';
import {
  findVisibleExercise,
  latestUnit,
  loadLastSets,
  listLoggedExercises,
  loadProgressPoints,
} from '../db/progress';
import { getAuthUser, requireAuth } from '../middleware/auth';
import { isProgressQuery, parseCreateExerciseBody, parseId, parseLastSetsQuery } from '../validation';
import type { ErrorResponse, Exercise, ExerciseLastSets, ExerciseProgress, LoggedExercise } from '../types/models';
import type { NoParams } from './types';

// Mounted at /exercises. Every route needs the user, since custom exercises are per user.
const exercisesRouter = Router();
exercisesRouter.use(requireAuth);

// Built-in exercises plus the user's own. Never another user's.
exercisesRouter.get('/', async (req: Request, res: Response<Exercise[]>) => {
  const result = await pool.query<Exercise>(
    `SELECT id, name, muscle_group, created_by FROM exercises
     WHERE created_by IS NULL OR created_by = $1
     ORDER BY name, id`,
    [getAuthUser(req).id]
  );
  res.json(result.rows);
});

// Creates a custom exercise. 409 if the user can already see one with that name, ignoring case.
exercisesRouter.post(
  '/',
  async (
    req: Request<NoParams, Exercise | ErrorResponse, unknown>,
    res: Response<Exercise | ErrorResponse>
  ) => {
    const body = parseCreateExerciseBody(req.body);
    if (body === null) {
      // Shown to the user in the app.
      return res.status(400).json({
        error: 'Exercise names must be 1 to 100 characters (muscle groups at most 50)',
      });
    }
    const user = getAuthUser(req);
    const duplicate = { error: `An exercise named "${body.name}" already exists` };

    try {
      // Checks for a duplicate and inserts in one statement, so nothing can sneak in between.
      // No row back means a duplicate exists.
      // The ::text and ::int casts are needed because $1 is used twice.
      const result = await pool.query<Exercise>(
        `INSERT INTO exercises (name, muscle_group, created_by)
         SELECT $1::text, $2::text, $3::int
         WHERE NOT EXISTS (
           SELECT 1 FROM exercises
           WHERE lower(name) = lower($1) AND (created_by IS NULL OR created_by = $3)
         )
         RETURNING id, name, muscle_group, created_by`,
        [body.name, body.muscle_group, user.id]
      );
      const exercise = result.rows[0];
      if (!exercise) {
        return res.status(409).json(duplicate);
      }
      return res.status(201).json(exercise);
    } catch (err: unknown) {
      // Two identical requests at the same moment can both pass the check above.
      // The unique index then rejects the second.
      if (isUniqueViolation(err, 'exercises_created_by_lower_name_key')) {
        return res.status(409).json(duplicate);
      }
      throw err;
    }
  }
);

// Exercises the user has logged, for the Progress tab.
exercisesRouter.get(
  '/logged',
  async (req: Request<NoParams>, res: Response<LoggedExercise[]>) => {
    res.json(await listLoggedExercises(getAuthUser(req).id));
  }
);

// "Last time" sets for the grey hints.
exercisesRouter.get(
  '/last-sets',
  async (req: Request<NoParams>, res: Response<ExerciseLastSets[] | ErrorResponse>) => {
    const query: unknown = req.query;
    const ids = parseLastSetsQuery(query);
    if (ids === null) {
      return res.status(400).json({ error: 'Invalid last-sets query' });
    }
    return res.json(await loadLastSets(ids, getAuthUser(req).id));
  }
);

// Chart data for one exercise.
// req.query is treated as unknown and checked by the guard, like req.body.
exercisesRouter.get(
  '/:id/progress',
  async (
    req: Request<{ id: string }>,
    res: Response<ExerciseProgress | ErrorResponse>
  ) => {
    const exerciseId = parseId(req.params.id);
    if (exerciseId === null) {
      return res.status(400).json({ error: 'Invalid exercise id' });
    }
    const query: unknown = req.query;
    if (!isProgressQuery(query)) {
      return res.status(400).json({ error: 'Invalid progress query' });
    }
    const user = getAuthUser(req);

    const exercise = await findVisibleExercise(exerciseId, user.id);
    if (!exercise) {
      return res.status(404).json({ error: 'Exercise not found' });
    }
    // The requested unit, else the unit of the last set, else lb.
    const unit = query.unit ?? (await latestUnit(exerciseId, user.id)) ?? 'lb';
    const points = await loadProgressPoints(exerciseId, user.id, unit, query);

    return res.json({ exercise_id: exercise.id, exercise_name: exercise.name, unit, points });
  }
);

export default exercisesRouter;