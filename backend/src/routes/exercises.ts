import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import type { Exercise } from '../types/models';

// Mounted at /exercises in app.ts, so '/' here is GET /exercises.
const exercisesRouter = Router();

exercisesRouter.get('/', async (req: Request, res: Response<Exercise[]>) => {
  // The generic tells pg what each row looks like, so result.rows is Exercise[].
  const result = await pool.query<Exercise>('SELECT * FROM exercises');
  res.json(result.rows);
});

export default exercisesRouter;
