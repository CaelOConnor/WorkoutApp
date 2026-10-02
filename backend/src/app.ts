import express, {
  type ErrorRequestHandler,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import { DatabaseError, type PoolClient } from 'pg';
import pool from './db/pool';
import { isAuthBody, isCreateWorkoutBody, isTokenPayload } from './validation';
import type {
  AuthUser,
  CreateWorkoutResponse,
  ErrorResponse,
  Exercise,
  LoginResponse,
  PublicUser,
  User,
  Workout,
  WorkoutHistoryRow,
} from './types/models';

// process.env values are `string | undefined`. Returning only after the check means callers get a `string`.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const JWT_SECRET = requireEnv('JWT_SECRET');

// None of our routes use URL params like /workouts/:id, so the params type is an empty object.
type NoParams = Record<string, never>;

// Middleware: runs before the route handler. Sending a response here stops the request;
// calling next() hands it on to the next handler in the chain.
const requireAuth: RequestHandler = (req, res, next) => {
  // Header values are `string | undefined`; `?.` makes the whole check false when it's missing.
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  // `let` declared outside the try so it's still in scope after it.
  let payload: unknown;
  try {
    // verify (unlike decode) checks the signature and `exp`, and throws if either is bad.
    // Pinning the algorithm stops a token's own header from choosing how it gets checked.
    payload = jwt.verify(header.slice('Bearer '.length), JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }
  if (!isTokenPayload(payload)) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return;
  }

  // `user` exists on Request because of src/types/express.d.ts.
  req.user = { id: payload.userId };
  next();
};

// For handlers behind requireAuth. Throwing (instead of a `!` assertion) means a route that
// forgot requireAuth fails loudly with a 500 from the error handler, not a silent `undefined`.
function getAuthUser(req: Request): AuthUser {
  if (!req.user) {
    throw new Error('getAuthUser called on a route without requireAuth');
  }
  return req.user;
}

const app = express();

app.use(cors());
app.use(express.json());

app.get('/', (req: Request, res: Response<string>) => {
  res.send('WorkoutApp API is alive');
});

app.get('/exercises', async (req: Request, res: Response<Exercise[]>) => {
  // The generic tells pg what each row looks like, so result.rows is Exercise[].
  const result = await pool.query<Exercise>('SELECT * FROM exercises');
  res.json(result.rows);
});

app.post(
  '/workouts',
  requireAuth,
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

app.get('/workouts', requireAuth, async (req: Request, res: Response<WorkoutHistoryRow[]>) => {
  const result = await pool.query<WorkoutHistoryRow>(
    `SELECT w.id, w.date, w.notes, s.exercise_id, e.name AS exercise_name, s.set_number, s.reps, s.weight, s.unit
     FROM workouts w
     JOIN sets s ON s.workout_id = w.id
     JOIN exercises e ON e.id = s.exercise_id
     ORDER BY w.date DESC, s.id ASC`
  );
  res.json(result.rows);
});

app.post(
  '/auth/signup',
  async (
    req: Request<NoParams, PublicUser | ErrorResponse, unknown>,
    res: Response<PublicUser | ErrorResponse>
  ) => {
    if (!isAuthBody(req.body)) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const { email, password } = req.body;

    try {
      const passwordHash = await bcrypt.hash(password, 10);
      const result = await pool.query<PublicUser>(
        'INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING id, email',
        [email, passwordHash]
      );
      const user = result.rows[0];
      if (!user) {
        throw new Error('User insert returned no row');
      }
      return res.status(201).json(user);
    } catch (err: unknown) {
      // instanceof narrows `unknown` to pg's DatabaseError, which has a `code` property.
      // 23505 = unique_violation (the email column is UNIQUE).
      if (err instanceof DatabaseError && err.code === '23505') {
        return res.status(409).json({ error: 'Email already in use' });
      }
      console.error('POST /auth/signup failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

app.post(
  '/auth/login',
  async (
    req: Request<NoParams, LoginResponse | ErrorResponse, unknown>,
    res: Response<LoginResponse | ErrorResponse>
  ) => {
    if (!isAuthBody(req.body)) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    const { email, password } = req.body;

    try {
      const result = await pool.query<User>('SELECT * FROM users WHERE email = $1', [email]);
      const user = result.rows[0]; // User | undefined

      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }
      // From here on, TypeScript knows `user` is a User.

      const passwordMatches = await bcrypt.compare(password, user.password_hash);

      if (!passwordMatches) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const token = jwt.sign({ userId: user.id }, JWT_SECRET, {
        expiresIn: '7d',
      });

      return res.json({ token, email: user.email });
    } catch (err: unknown) {
      console.error('POST /auth/login failed:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }
  }
);

// Catches anything a route throws or rejects with (e.g. GET /exercises when the DB is down),
// so clients never see Express's default error page with the message and stack trace.
// Express only treats a middleware as an error handler if it declares all four parameters.
const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  console.error(`${req.method} ${req.path} failed:`, err);
  // If the response already started streaming we can't send a new status; let Express close it.
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal server error' });
};
app.use(errorHandler);

// Exported without calling listen(), so tests can hand `app` to supertest without opening port 3000.
export default app;
