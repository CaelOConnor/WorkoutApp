import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { createUser, pool, resetDb } from './db';

const EMAIL = 'lifter@example.com';
const PASSWORD = 'correct-horse';

// Close the pool's connections so the test worker can exit cleanly.
afterAll(async () => {
  await pool.end();
});

describe('POST /auth/login', () => {
  // beforeEach runs before every `it`, so no test sees rows left over by another.
  beforeEach(async () => {
    await resetDb();
    await createUser(EMAIL, PASSWORD);
  });

  it('returns 401 with { error } for a wrong password', async () => {
    const res = await request(app).post('/auth/login').send({ email: EMAIL, password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it('returns the same 401 for an unknown email (does not reveal which emails exist)', async () => {
    const res = await request(app).post('/auth/login').send({ email: 'nobody@example.com', password: PASSWORD });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Invalid email or password' });
  });

  // A positive control: without it, a route that always returned 401 would pass the tests above.
  it('returns 200 with a token for the correct password', async () => {
    const res = await request(app).post('/auth/login').send({ email: EMAIL, password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.any(String), email: EMAIL });
  });

  it('ignores case and surrounding spaces in the email', async () => {
    const res = await request(app).post('/auth/login').send({ email: ' Lifter@Example.COM ', password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ token: expect.any(String), email: EMAIL });
  });
});

describe('POST /auth/signup', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('stores the email trimmed and lowercased', async () => {
    const res = await request(app).post('/auth/signup').send({ email: ' Lifter@Example.COM ', password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({ id: expect.any(Number), email: EMAIL });
  });

  it('returns 409 for an email that differs from an existing one only in case', async () => {
    await createUser(EMAIL, PASSWORD);

    const res = await request(app).post('/auth/signup').send({ email: 'LIFTER@example.com', password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'Email already in use' });
  });

  it('returns 400 for an email that is only spaces', async () => {
    const res = await request(app).post('/auth/signup').send({ email: '   ', password: PASSWORD });

    expect(res.status).toBe(400);
  });
});
