import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import {
  findVisibleExercise,
  latestUnit,
  listLoggedExercises,
  loadProgressPoints,
} from '../db/progress';
import { getAuthUser, requireAuth } from '../middleware/auth';
import { isProgressQuery, parseId } from '../validation';
import type { ErrorResponse, Exercise, ExerciseProgress, LoggedExercise } from '../types/models';
import type { NoParams } from './types';

// Mounted at /exercises in app.ts, so '/' here is GET /exercises.
const exercisesRouter = Router();

exercisesRouter.get('/', async (req: Request, res: Response<Exercise[]>) => {
  // The generic tells pg what each row looks like, so result.rows is Exercise[].
  const result = await pool.query<Exercise>('SELECT * FROM exercises');
  res.json(result.rows);
});

// GET /exercises itself is still public (see ROADMAP.md), so auth is added per route here instead
// of with exercisesRouter.use(requireAuth). Express runs the handlers in the order they're listed.
exercisesRouter.get(
  '/logged',
  requireAuth,
  async (req: Request<NoParams>, res: Response<LoggedExercise[]>) => {
    res.json(await listLoggedExercises(getAuthUser(req).id));
  }
);

// req.query is Express's ParsedQs: each value is a string, an array (a repeated key), or a nested
// object. It's widened to `unknown` below and narrowed by isProgressQuery, as req.body is in the
// workouts routes. Narrowing ParsedQs directly wouldn't work: ProgressQuery isn't a subtype of it,
// so TypeScript would keep ParsedQs's value types and query.unit wouldn't become a WeightUnit.
exercisesRouter.get(
  '/:id/progress',
  requireAuth,
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
    // `??` moves on only when the left side is null or undefined: the requested unit, else the
    // most recent set's, else lb for an exercise never logged.
    const unit = query.unit ?? (await latestUnit(exerciseId, user.id)) ?? 'lb';
    const points = await loadProgressPoints(exerciseId, user.id, unit, query);

    return res.json({ exercise_id: exercise.id, exercise_name: exercise.name, unit, points });
  }
);

export default exercisesRouter;
