import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import healthRouter from './routes/health';
import exercisesRouter from './routes/exercises';
import workoutsRouter from './routes/workouts';
import authRouter from './routes/auth';

const app = express();

app.use(cors());
app.use(express.json());

// Each router's paths are relative to where it's mounted: '/login' in authRouter is /auth/login.
app.use('/', healthRouter);
app.use('/exercises', exercisesRouter);
app.use('/workouts', workoutsRouter);
app.use('/auth', authRouter);

// Catches anything a route throws or rejects with (e.g. GET /exercises when the DB is down),
// so clients never see Express's default error page with the message and stack trace.
// Express only treats a middleware as an error handler if it declares all four parameters.
// Registered after the routers, because Express runs middleware in the order it was added.
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
