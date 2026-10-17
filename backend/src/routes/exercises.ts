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

// Mounted at /exercises in app.ts, so '/' here is GET /exercises.
const exercisesRouter = Router();

// Every exercise route depends on who's asking (custom exercises are per user), so auth runs once
// for the whole router, as in workoutsRouter.
exercisesRouter.use(requireAuth);

// The exercises the caller can use: the built-in ones (created_by NULL) and their own custom ones.
// Another user's custom exercises are never listed.
exercisesRouter.get('/', async (req: Request, res: Response<Exercise[]>) => {
  // The generic tells pg what each row looks like, so result.rows is Exercise[].
  const result = await pool.query<Exercise>(
    `SELECT id, name, muscle_group, created_by FROM exercises
     WHERE created_by IS NULL OR created_by = $1
     ORDER BY name, id`,
    [getAuthUser(req).id]
  );
  res.json(result.rows);
});

// Creates a custom exercise owned by the caller. 409 if the caller can already see an exercise
// with that name, ignoring case: one of their own, or a built-in one.
exercisesRouter.post(
  '/',
  async (
    req: Request<NoParams, Exercise | ErrorResponse, unknown>,
    res: Response<Exercise | ErrorResponse>
  ) => {
    const body = parseCreateExerciseBody(req.body);
    if (body === null) {
      // Written for the user, since the app shows it: the name is the field they typed.
      return res.status(400).json({
        error: 'Exercise names must be 1 to 100 characters (muscle groups at most 50)',
      });
    }
    const user = getAuthUser(req);
    const duplicate = { error: `An exercise named "${body.name}" already exists` };

    try {
      // INSERT ... SELECT ... WHERE NOT EXISTS: one statement that inserts only if no visible
      // exercise has this name, so there's no gap between a separate check and the insert.
      // lower() on both sides makes the comparison ignore case, the same way the unique index does.
      // The casts give each parameter one type: $1 is used twice, and without a FROM table
      // Postgres can't infer it ("inconsistent types deduced for parameter $1").
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
      // Two identical requests at once can both pass NOT EXISTS (neither sees the other's
      // uncommitted row); the unique index then rejects the second one.
      if (isUniqueViolation(err, 'exercises_created_by_lower_name_key')) {
        return res.status(409).json(duplicate);
      }
      throw err;
    }
  }
);

exercisesRouter.get(
  '/logged',
  async (req: Request<NoParams>, res: Response<LoggedExercise[]>) => {
    res.json(await listLoggedExercises(getAuthUser(req).id));
  }
);

// The sets to prefill new sets with: "last time" for each exercise id (see ExerciseLastSets).
// req.query is widened to unknown and narrowed, as in /:id/progress below.
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

// req.query is Express's ParsedQs: each value is a string, an array (a repeated key), or a nested
// object. It's widened to `unknown` below and narrowed by isProgressQuery, as req.body is in the
// workouts routes. Narrowing ParsedQs directly wouldn't work: ProgressQuery isn't a subtype of it,
// so TypeScript would keep ParsedQs's value types and query.unit wouldn't become a WeightUnit.
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
    // `??` moves on only when the left side is null or undefined: the requested unit, else the
    // most recent set's, else lb for an exercise never logged.
    const unit = query.unit ?? (await latestUnit(exerciseId, user.id)) ?? 'lb';
    const points = await loadProgressPoints(exerciseId, user.id, unit, query);

    return res.json({ exercise_id: exercise.id, exercise_name: exercise.name, unit, points });
  }
);

export default exercisesRouter;
