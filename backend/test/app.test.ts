import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';

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
  // it.each runs the same test once per row, so each bad body shows up as its own result.
  it.each([
    ['no body', undefined],
    ['missing sets', { notes: 'leg day' }],
    ['sets is not an array', { sets: 'lots' }],
    ['set with a string weight', { sets: [{ exercise_id: 1, set_number: 1, reps: 5, weight: '135' }] }],
    ['set with an unknown unit', { sets: [{ exercise_id: 1, set_number: 1, reps: 5, weight: 135, unit: 'st' }] }],
  ])('returns 400 with { error } for %s', async (_label, body) => {
    const res = await request(app).post('/workouts').send(body);

    expect(res.status).toBe(400);
    // toEqual compares structure, and expect.any(String) matches any string,
    // so the test pins the response shape without depending on the exact message.
    expect(res.body).toEqual({ error: expect.any(String) });
  });
});
