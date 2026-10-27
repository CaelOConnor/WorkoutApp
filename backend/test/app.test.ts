import { describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../src/app';
import { authHeader } from './tokens';
import { TEST_JWT_SECRET } from './test-env';

// supertest's request(app) runs the app on a temporary port for one request, so no server needs to be up.

describe('GET /', () => {
  it('responds 200 with the health message', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.text).toBe('WorkoutApp API is alive');
  });
});

describe('POST /workouts', () => {
  // A valid body, so a 400 from validation can't hide whether auth ran.
  it('returns 401 with { error } when no token is sent', async () => {
    const res = await request(app)
      .post('/workouts')
      .send({ date: '2026-10-07', sets: [{ exercise_id: 1, reps: 5, weight: 135 }] });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it.each([
    ['a malformed token', 'Bearer not-a-jwt'],
    // Well formed but signed with another key, like a forged token.
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
      .send({ date: '2026-10-07', sets: [{ exercise_id: 1, reps: 5, weight: 135 }] });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  // it.each runs the same test once per row, so each bad body shows up as its own result.
  it.each([
    ['no body', undefined],
    ['missing date', { sets: [{ exercise_id: 1, reps: 5, weight: 135 }] }],
    ['missing sets', { date: '2026-10-07', notes: 'leg day' }],
    ['sets is not an array', { date: '2026-10-07', sets: 'lots' }],
    ['set with a string weight', { date: '2026-10-07', sets: [{ exercise_id: 1, reps: 5, weight: '135' }] }],
    ['set with an unknown unit', { date: '2026-10-07', sets: [{ exercise_id: 1, reps: 5, weight: 135, unit: 'st' }] }],
  ])('returns 400 with { error } for %s', async (_label, body) => {
    const res = await request(app).post('/workouts').set('Authorization', authHeader(1)).send(body);

    expect(res.status).toBe(400);
    // expect.any(String) pins the shape without depending on the exact message.
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
