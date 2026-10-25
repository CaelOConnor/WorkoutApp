import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { createExercise, createUser, pool, resetDb } from './db';
import type { Exercise, PublicUser } from '../src/types/models';

afterAll(async () => {
  await pool.end();
});

describe('GET /exercises', () => {
  let lifter: PublicUser;
  let other: PublicUser;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    other = await createUser('other@example.com', 'password');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/exercises');

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: expect.any(String) });
  });

  it("returns the built-in exercises and the caller's own, never another user's", async () => {
    const squat = await createExercise('Squat');
    const mine = await createExercise('My Lunge', lifter.id);
    await createExercise('Their Lunge', other.id);

    const res = await request(app).get('/exercises').set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    const expected: Exercise[] = [
      { id: squat.id, name: 'Squat', muscle_group: null, created_by: null },
      { id: mine.id, name: 'My Lunge', muscle_group: null, created_by: lifter.id },
    ];
    // arrayContaining + length: the same items in any order (the app sorts the list itself).
    expect(res.body).toEqual(expect.arrayContaining(expected));
    expect(res.body).toHaveLength(expected.length);
  });
});

describe('POST /exercises', () => {
  let lifter: PublicUser;
  let other: PublicUser;

  beforeEach(async () => {
    await resetDb();
    lifter = await createUser('lifter@example.com', 'password');
    other = await createUser('other@example.com', 'password');
    await createExercise('Bench Press');
  });

  // `object` (not a specific body type) so tests can send malformed bodies; arrays are objects too.
  function post(body: object) {
    return request(app).post('/exercises').set('Authorization', authHeader(lifter.id)).send(body);
  }

  async function namesOf(userId: number): Promise<string[]> {
    const result = await pool.query<{ name: string }>(
      'SELECT name FROM exercises WHERE created_by = $1 ORDER BY id',
      [userId]
    );
    return result.rows.map((row) => row.name);
  }

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/exercises').send({ name: 'Curl' });

    expect(res.status).toBe(401);
  });

  it('creates a custom exercise for the caller, with the name trimmed, and returns 201', async () => {
    const res = await post({ name: '  Cable Fly ', muscle_group: ' Chest ' });

    expect(res.status).toBe(201);
    const expected: Exercise = {
      id: expect.any(Number),
      name: 'Cable Fly',
      muscle_group: 'Chest',
      created_by: lifter.id,
    };
    expect(res.body).toEqual(expected);
    expect(await namesOf(lifter.id)).toEqual(['Cable Fly']);
  });

  it('shows the new exercise in GET /exercises for the caller only', async () => {
    const created = await post({ name: 'Cable Fly' });

    const mine = await request(app).get('/exercises').set('Authorization', authHeader(lifter.id));
    const theirs = await request(app).get('/exercises').set('Authorization', authHeader(other.id));

    expect(mine.body).toContainEqual(created.body);
    expect(theirs.body).not.toContainEqual(created.body);
  });

  it.each([
    ['missing', {}],
    ['blank', { muscle_group: '   ' }],
  ])('stores a %s muscle_group as null', async (_label, extra) => {
    const res = await post({ name: 'Curl', ...extra });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name: 'Curl', muscle_group: null });
  });

  // Postgres counts characters, but JS's .length counts UTF-16 code units, and an emoji is two
  // of them. 100 emoji fit VARCHAR(100) even though .length says 200.
  it.each([
    ['100 letters', 'a'.repeat(100)],
    ['100 emoji', '💪'.repeat(100)],
  ])('accepts a name of %s', async (_label, name) => {
    const res = await post({ name });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ name });
  });

  it.each([
    ['a missing name', { muscle_group: 'Chest' }],
    ['an empty name', { name: '' }],
    ['a name of only spaces', { name: '   ' }],
    ['a name that is not a string', { name: 42 }],
    ['a name over 100 characters', { name: 'a'.repeat(101) }],
    ['a muscle_group that is not a string', { name: 'Curl', muscle_group: 5 }],
    ['a muscle_group over 50 characters', { name: 'Curl', muscle_group: 'a'.repeat(51) }],
    // Rejected, not ignored, so a client can't think it chose the owner.
    ['an unknown key', { name: 'Curl', created_by: 99 }],
    ['a body that is not an object', ['Curl']],
  ])('returns 400 and saves nothing for %s', async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: expect.any(String) });
    expect(await namesOf(lifter.id)).toEqual([]);
  });

  it('returns 409 for a name the caller already has, ignoring case and spaces', async () => {
    await createExercise('Cable Fly', lifter.id);

    const res = await post({ name: ' cable FLY ' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: expect.stringContaining('already exists') });
    expect(await namesOf(lifter.id)).toEqual(['Cable Fly']);
  });

  it('returns 409 for the name of a built-in exercise, ignoring case', async () => {
    const res = await post({ name: 'bench press' });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: expect.stringContaining('already exists') });
    expect(await namesOf(lifter.id)).toEqual([]);
  });

  it("allows a name another user already has: their exercises aren't visible to the caller", async () => {
    await createExercise('Cable Fly', other.id);

    const res = await post({ name: 'Cable Fly' });

    expect(res.status).toBe(201);
  });
});
