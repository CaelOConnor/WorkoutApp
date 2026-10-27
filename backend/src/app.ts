import express, { type ErrorRequestHandler } from 'express';
import cors from 'cors';
import { requestLogger } from './middleware/requestLogger';
import healthRouter from './routes/health';
import exercisesRouter from './routes/exercises';
import workoutsRouter from './routes/workouts';
import templatesRouter from './routes/templates';
import authRouter from './routes/auth';

const app = express();

// Middleware runs in the order it's added.
// Logger first so its timing covers everything, its off in tests to keep the output readable.
if (process.env.NODE_ENV !== 'test') {
  app.use(requestLogger(console.log));
}
app.use(cors());
app.use(express.json());

// Router paths are relative: '/login' in authRouter is /auth/login.
app.use('/', healthRouter); // checks server is up
app.use('/exercises', exercisesRouter);
app.use('/workouts', workoutsRouter);
app.use('/templates', templatesRouter);
app.use('/auth', authRouter);

// Reached only when no router matched, so unknown URLs get JSON instead of Express's HTML page.
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// express.json() marks a body it can't parse with this type. A client mistake, so not logged.
function isJsonParseError(err: unknown): boolean {
  return err instanceof SyntaxError && 'type' in err && err.type === 'entity.parse.failed';
}

// Last, so it catches errors from every route. Sends a generic message instead of
// Express's default page, which would show the stack trace.
// Must take all four parameters, or Express won't treat it as an error handler.
const errorHandler: ErrorRequestHandler = (err: unknown, req, res, next) => {
  if (isJsonParseError(err)) {
    res.status(400).json({ error: 'Invalid JSON' });
    return;
  }
  console.error(`${req.method} ${req.path} failed:`, err);
  // Too late to change the status once the response has started.
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ error: 'Internal server error' });
};
app.use(errorHandler);

// No listen() here (index.ts does that), so tests can use the app without opening a port.
export default app;