import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { authHeader } from './tokens';
import { TEST_JWT_SECRET } from './test-env';

// supertest's request(app) starts the app on a temporary port, sends one request, and closes it.
// Each `it` is one behavior; `describe` just groups them in the output.

describe('GET /', () => {
  it('responds 200 with the health message', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toBe('WorkoutApp API is alive');
  });
});

describe('POST /workouts', () => {
  // A valid body, so the only thing wrong with the request is the missing token.
  // Otherwise a 400 from validation could hide whether auth ran at all.
  it('returns 401 with { error } when no token is sent', async () => {
    const res = await request(app)
      .post('/workouts')
      .send({ sets: [{ exercise_id: 1, set_number: 1, reps: 5, weight: 135 }] });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each([
    ['a malformed token', 'Bearer not-a-jwt'],
    // Correctly formed, but signed with a key the server doesn't know: a forged token.
    ['a token signed with the wrong secret', `Bearer ${jwt.sign({ userId: 1 }, 'not-the-secret')}`],
    // `exp` is seconds since the epoch; one minute ago means already expired.
    [
      'an expired token',
      `Bearer ${jwt.sign({ userId: 1, exp: Math.floor(Date.now() / 1000) - 60 }, TEST_JWT_SECRET)}`,
    ],
  ])('returns 401 with { error } for %s', async (_label, authorization) => {
    const res = await request(app)
      .post('/workouts')
      .set('Authorization', authorization)
      .send({ sets: [{ exercise_id: 1, set_number: 1, reps: 5, weight: 135 }] });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  // it.each runs the same test once per row, so each bad body shows up as its own result.
  it.each([
    ['no body', undefined],
    ['missing sets', { notes: 'leg day' }],
    ['sets is not an array', { sets: 'lots' }],
    ['set with a string weight', { sets: [{ exercise_id: 1, set_number: 1, reps: 5, weight: '135' }] }],
    ['set with an unknown unit', { sets: [{ exercise_id: 1, set_number: 1, reps: 5, weight: 135, unit: 'st' }] }],
  ])('returns 400 with { error } for %s', async (_label, body) => {
    const res = await request(app).post('/workouts').set('Authorization', authHeader(1)).send(body);

    expect(res.status).toBe(400);
    // toEqual compares structure, and expect.any(String) matches any string,
    // so the test pins the response shape without depending on the exact message.
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});

describe('GET /workouts', () => {
  it('returns 401 with { error } when no token is sent', async () => {
    const res = await request(app).get('/workouts');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});
