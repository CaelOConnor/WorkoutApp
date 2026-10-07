import { Router, type Request, type Response } from 'express';
import { DatabaseError, type PoolClient } from 'pg';
import pool from '../db/pool';
import { getAuthUser, requireAuth } from '../middleware/auth';
import { isCreateWorkoutBody, isUpdateWorkoutBody, parseId } from '../validation';
import type {
  CreateWorkoutResponse,
  ErrorResponse,
  Workout,
  WorkoutDetail,
  WorkoutDetailSet,
  WorkoutHistoryRow,
} from '../types/models';
import type { NoParams } from './types';

// Mounted at /workouts in app.ts, so '/' here is /workouts.
const workoutsRouter = Router();

// Every workout route belongs to a user, so auth runs once for the whole router instead of
// being repeated on each route. Middleware added with use() runs in order, so this must come
// before the routes. It only sees requests under /workouts, since that's where the router is mounted.
workoutsRouter.use(requireAuth);

workoutsRouter.post(
  '/',
  async (
    req: Request<NoParams, CreateWorkoutResponse | ErrorResponse, unknown>,
    res: Response<CreateWorkoutResponse | ErrorResponse>
  ) => {
    // req.body is `unknown` here; after this check it is CreateWorkoutBody.
    if (!isCreateWorkoutBody(req.body)) {
      return res.status(400).json({ error: 'Invalid workout body' });
    }
    const { date, notes, sets } = req.body;
    const user = getAuthUser(req);
    // Declared outside the try so catch/finally can see it; stays undefined if connect() fails.
    let client: PoolClient | undefined;

    try {
      client = await pool.connect();
      await client.query('BEGIN');

      const workoutResult = await client.query<Pick<Workout, 'id'>>(
        'INSERT INTO workouts (user_id, date, notes) VALUES ($1, $2, $3) RETURNING id',
        [user.id, date || new Date(), notes || null]
      );
      // rows[0] is `Pick<Workout, 'id'> | undefined` because of noUncheckedIndexedAccess.
      const workout = workoutResult.rows[0];
      if (!workout) {
        throw new Error('Workout insert returned no row');
      }

      for (const set of sets) {
        await client.query(
          'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight, unit) VALUES ($1, $2, $3, $4, $5, $6)',
          [workout.id, set.exercise_id, set.set_number, set.reps, set.weight, set.unit ?? 'lb']
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ id: workout.id });
    } catch (err: unknown) {
      // Here `client` is `PoolClient | undefined`: TypeScript can't know which line threw.
      if (client) {
        // Log a failed ROLLBACK (e.g. the connection dropped) but still report the original error.
        await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
          console.error('ROLLBACK failed:', rollbackErr);
        });
      }
      // Checked after ROLLBACK: a failed statement leaves the transaction aborted, and the
      // client must not go back to the pool in that state.
      // 23503 = foreign_key_violation. Matching the constraint name too, because a missing
      // user (workouts.user_id) is also 23503 and isn't the client's fault.
      if (
        err instanceof DatabaseError &&
        err.code === '23503' &&
        err.constraint === 'sets_exercise_id_fkey'
      ) {
        return res.status(400).json({ error: 'Unknown exercise_id' });
      }
      console.error('POST /workouts failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    } finally {
      // Only release a client we actually acquired.
      if (client) {
        client.release();
      }
    }
  }
);

workoutsRouter.get('/', async (req: Request, res: Response<WorkoutHistoryRow[]>) => {
  const user = getAuthUser(req);
  // $1 is a placeholder: pg sends user.id separately from the SQL text, so it can't inject SQL.
  const result = await pool.query<WorkoutHistoryRow>(
    `SELECT w.id, w.date, w.notes, s.exercise_id, e.name AS exercise_name, s.set_number, s.reps, s.weight, s.unit
     FROM workouts w
     JOIN sets s ON s.workout_id = w.id
     JOIN exercises e ON e.id = s.exercise_id
     WHERE w.user_id = $1
     ORDER BY w.date DESC, s.id ASC`,
    [user.id]
  );
  res.json(result.rows);
});

// One workout with its sets nested, or null if it doesn't exist or belongs to someone else.
// Filtering on user_id in SQL means another user's workout simply isn't found, so callers give
// it the same 404 as a missing id and the response can't reveal that it exists.
async function loadWorkoutDetail(id: number, userId: number): Promise<WorkoutDetail | null> {
  const workoutResult = await pool.query<Pick<Workout, 'id' | 'date' | 'notes'>>(
    'SELECT id, date, notes FROM workouts WHERE id = $1 AND user_id = $2',
    [id, userId]
  );
  const workout = workoutResult.rows[0];
  if (!workout) {
    return null;
  }

  const setsResult = await pool.query<WorkoutDetailSet>(
    `SELECT s.id, s.exercise_id, e.name AS exercise_name, s.set_number, s.reps, s.weight, s.unit
     FROM sets s
     JOIN exercises e ON e.id = s.exercise_id
     WHERE s.workout_id = $1
     ORDER BY s.set_number ASC`,
    [workout.id]
  );

  // Spread copies the workout's fields into a new object, then sets is added alongside them.
  return { ...workout, sets: setsResult.rows };
}

// ':id' is a route param: Express matches any single path segment there and puts it in
// req.params.id. The first generic on Request types req.params. It's always a string, because
// it's cut out of the URL text; Express never converts it.
workoutsRouter.get(
  '/:id',
  async (
    req: Request<{ id: string }, WorkoutDetail | ErrorResponse>,
    res: Response<WorkoutDetail | ErrorResponse>
  ) => {
    // Checked before any query: a malformed id is the client's mistake (400), and Postgres
    // would otherwise reject it with an error that turns into a 500.
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

// The third generic on Request types req.body. It's `unknown` so the guard has to narrow it.
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
    // Build the SET clause from only the fields that were sent, so a missing field isn't
    // touched. Column names are fixed here in the code, never taken from the request, and
    // every value still goes through a $n placeholder.
    const assignments: string[] = [];
    // null is a valid value: pg sends it as SQL NULL, which clears the column.
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
    // The WHERE has the same ownership rule as GET: another user's workout matches no row, so
    // nothing is updated and it gets the same 404 as a missing id.
    const updateResult = await pool.query(
      `UPDATE workouts SET ${assignments.join(', ')}
       WHERE id = $${values.length + 1} AND user_id = $${values.length + 2}`,
      [...values, id, user.id]
    );
    // rowCount is how many rows the UPDATE changed: 0 means no workout of this user's has that id.
    if (updateResult.rowCount === 0) {
      return res.status(404).json({ error: 'Workout not found' });
    }

    // Reload through the same helper as GET, so both routes return an identical shape.
    const workout = await loadWorkoutDetail(id, user.id);
    if (!workout) {
      // Only possible if the workout was deleted between the two queries.
      return res.status(404).json({ error: 'Workout not found' });
    }
    return res.json(workout);
  }
);

export default workoutsRouter;
