import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import { isUnknownExerciseError } from '../db/errors';
import { withTransaction } from '../db/transaction';
import { listWorkoutDetails, loadWorkoutDetail } from '../db/workoutDetail';
import { addWorkoutExercise } from '../db/workoutExercises';
import { getAuthUser, requireAuth } from '../middleware/auth';
import { isCreateWorkoutBody, isUpdateWorkoutBody, parseId } from '../validation';
import type {
  CreateWorkoutResponse,
  ErrorResponse,
  Workout,
  WorkoutDetail,
} from '../types/models';
import type { NoParams } from './types';
import setsRouter from './sets';
import workoutExercisesRouter from './workoutExercises';

// Mounted at /workouts in app.ts.
const workoutsRouter = Router();

// Every route below needs a logged-in user. Must come before the routes.
workoutsRouter.use(requireAuth);

// Sub-routers for one workout's sets and exercises.
workoutsRouter.use('/:id/sets', setsRouter);
workoutsRouter.use('/:id/exercises', workoutExercisesRouter);

// Request<Params, ResponseBody, RequestBody>. Body is unknown until the guard checks it.
workoutsRouter.post(
  '/',
  async (
    req: Request<NoParams, CreateWorkoutResponse | ErrorResponse, unknown>,
    res: Response<CreateWorkoutResponse | ErrorResponse>
  ) => {
    if (!isCreateWorkoutBody(req.body)) {
      return res.status(400).json({ error: 'Invalid workout body' });
    }
    const { date, notes, sets } = req.body;
    const user = getAuthUser(req);

    try {
      // All or nothing: if any set fails, the whole workout is undone.
      const workoutId = await withTransaction(async (client) => {
        const workoutResult = await client.query<Pick<Workout, 'id'>>(
          'INSERT INTO workouts (user_id, date, notes) VALUES ($1, $2, $3) RETURNING id',
          [user.id, date, notes || null]
        );
        const workout = workoutResult.rows[0];
        if (!workout) {
          throw new Error('Workout insert returned no row');
        }

        // Number each exercise's sets 1, 2, 3... in the order sent.
        const countByExercise = new Map<number, number>();
        for (const set of sets) {
          const setNumber = (countByExercise.get(set.exercise_id) ?? 0) + 1;
          countByExercise.set(set.exercise_id, setNumber);
          // First set of an exercise also records the exercise's position in the workout.
          if (setNumber === 1) {
            await addWorkoutExercise(client, workout.id, set.exercise_id);
          }
          await client.query(
            'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight, unit) VALUES ($1, $2, $3, $4, $5, $6)',
            [workout.id, set.exercise_id, setNumber, set.reps, set.weight, set.unit ?? 'lb']
          );
        }
        return workout.id;
      });
      return res.status(201).json({ id: workoutId });
    } catch (err: unknown) {
      if (isUnknownExerciseError(err)) {
        return res.status(400).json({ error: 'Unknown exercise_id' });
      }
      throw err; // anything else error handler (500)
    }
  }
);

workoutsRouter.get('/', async (req: Request, res: Response<WorkoutDetail[]>) => {
  const user = getAuthUser(req);
  res.json(await listWorkoutDetails(user.id));
});

workoutsRouter.get(
  '/:id',
  async (
    req: Request<{ id: string }, WorkoutDetail | ErrorResponse>,
    res: Response<WorkoutDetail | ErrorResponse>
  ) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid workout id' });
    }
    const user = getAuthUser(req);
    const workout = await loadWorkoutDetail(id, user.id);
    if (!workout) {
      return res.status(404).json({ error: 'Workout not found' });
    }
    return res.json(workout);
  }
);

workoutsRouter.patch(
  '/:id',
  async (
    req: Request<{ id: string }, WorkoutDetail | ErrorResponse, unknown>,
    res: Response<WorkoutDetail | ErrorResponse>
  ) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid workout id' });
    }
    if (!isUpdateWorkoutBody(req.body)) {
      return res.status(400).json({ error: 'Invalid workout body' });
    }
    const { date, notes } = req.body;
    // Only update the fields that were sent. Column names are fixed here;
    // values always go through $n placeholders.
    const assignments: string[] = [];
    const values: (string | null)[] = [];
    if (date !== undefined) {
      values.push(date);
      assignments.push(`date = $${values.length}`);
    }
    if (notes !== undefined) {
      values.push(notes);
      assignments.push(`notes = $${values.length}`);
    }
    const user = getAuthUser(req);
    // Only matches if this user owns the workout. Otherwise nothing changes and it's a 404.
    const updateResult = await pool.query(
      `UPDATE workouts SET ${assignments.join(', ')}
       WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}`,
      [...values, id, user.id]
    );
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    // Reload so PATCH returns the same shape as GET.
    const workout = await loadWorkoutDetail(id, user.id);
    if (!workout) {
      return res.status(404).json({ error: 'Workout not found' }); // deleted in between
    }
    return res.json(workout);
  }
);

workoutsRouter.delete('/:id', async (req: Request<{ id: string }>, res: Response<ErrorResponse>) => {
  const id = parseId(req.params.id);
  if (id === null) {
    return res.status(400).json({ error: 'Invalid workout id' });
  }
  const user = getAuthUser(req);
  // Its sets are deleted too (cascade in the database).
  const result = await pool.query('DELETE FROM workouts WHERE id = $1 AND user_id = $2', [id, user.id]);
  if (result.rowCount === 0) {
    return res.status(404).json({ error: 'Workout not found' });
  }
  return res.status(204).end(); // success, no body
});

export default workoutsRouter;