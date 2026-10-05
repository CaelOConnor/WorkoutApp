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

  it('can run twice without duplicating exercises or users', async () => {
    await seed();
    await seed();

    // COUNT(*) comes back from pg as a string (it's a bigint), hence `string` and '5'.
    const exercises = await pool.query<{ count: string }>('SELECT COUNT(*) FROM exercises');
    const users = await pool.query<{ count: string }>('SELECT COUNT(*) FROM users');
    expect(exercises.rows[0]?.count).toBe('5');
    expect(users.rows[0]?.count).toBe('1');
  });
});
