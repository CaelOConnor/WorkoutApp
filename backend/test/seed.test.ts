import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seed } from '../src/db/seed';
import { pool, resetDb } from './db';

afterAll(async () => {
  await pool.end();
});

describe('seed', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('can run twice without duplicating exercises', async () => {
    await seed();
    await seed();

    // COUNT(*) comes back from pg as a string (it's a bigint), hence `string` and '5'.
    const exercises = await pool.query<{ count: string }>('SELECT COUNT(*) FROM exercises');
    expect(exercises.rows[0]?.count).toBe('5');
  });

  // Users sign up in the app, so their passwords are real bcrypt hashes.
  it('adds no users', async () => {
    await seed();

    const users = await pool.query<{ count: string }>('SELECT COUNT(*) FROM users');
    expect(users.rows[0]?.count).toBe('0');
  });
});
