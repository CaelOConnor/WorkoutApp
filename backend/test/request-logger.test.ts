import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { requestLogger } from '../src/middleware/requestLogger';

// A tiny app with only the logger and a few routes, so each test controls exactly what happens.
// `now` is a fake clock: each call returns the next value, so durations are exact.
function appWith(lines: string[], times: number[]) {
  const app = express();
  app.use(
    requestLogger(
      (line) => lines.push(line),
      () => times.shift() ?? 0
    )
  );
  app.delete('/workouts/3/sets/5', (_req, res) => {
    res.status(204).end();
  });
  app.get('/boom', () => {
    throw new Error('boom');
  });
  // Never answers, like a request still waiting on the database when the phone gives up.
  app.get('/hang', () => {});
  return app;
}

describe('requestLogger', () => {
  it('logs the method, path, status and duration once the response is sent', async () => {
    const lines: string[] = [];
    const app = appWith(lines, [1000, 1012.4]);

    await request(app).delete('/workouts/3/sets/5');

    expect(lines).toEqual(['DELETE /workouts/3/sets/5 204 12ms']);
  });

  it('keeps the query string, and logs errors and unknown routes with their status', async () => {
    const lines: string[] = [];
    const app = appWith(lines, [0, 3, 10, 15]);

    await request(app).get('/boom?unit=kg');
    await request(app).get('/nope');

    // Express's default handler answers a thrown error with 500 and an unknown path with 404.
    expect(lines).toEqual(['GET /boom?unit=kg 500 3ms', 'GET /nope 404 5ms']);
  });

  it('logs a request the client gave up on before it was answered', async () => {
    const lines: string[] = [];
    const app = appWith(lines, [0, 50]);

    // timeout(): supertest aborts the request after 20 ms, like the app's 10 s timeout would.
    await request(app).get('/hang').timeout(20).catch(() => {});

    // The server notices the closed connection a moment later; vi.waitFor retries until then.
    await vi.waitFor(() => expect(lines).toEqual(['GET /hang aborted by client after 50ms']));
  });
});
