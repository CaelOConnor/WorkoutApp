import type { PoolClient } from 'pg';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/db/transaction';
import { createUser, pool, resetDb } from './db';

afterAll(async () => {
  await pool.end();
});

async function emails(): Promise<string[]> {
  const result = await pool.query<{ email: string }>('SELECT email FROM users ORDER BY id');
  return result.rows.map((row) => row.email);
}

async function insertUser(client: PoolClient, email: string): Promise<void> {
  await client.query("INSERT INTO users (email, password_hash) VALUES ($1, 'x')", [email]);
}

describe('withTransaction', () => {
  beforeEach(async () => {
    await resetDb();
    await createUser('existing@example.com', 'pw');
  });

  it('commits what the callback wrote and returns its value', async () => {
    const value = await withTransaction(async (client) => {
      await insertUser(client, 'a@example.com');
      await insertUser(client, 'b@example.com');
      return 42;
    });

    expect(value).toBe(42);
    expect(await emails()).toEqual(['existing@example.com', 'a@example.com', 'b@example.com']);
  });

  it('rolls back everything the callback wrote when it throws, and rethrows the same error', async () => {
    const failure = new Error('boom');

    const run = withTransaction(async (client) => {
      await insertUser(client, 'a@example.com');
      throw failure;
    });

    // toBe, so it must be the very same error object, not a wrapped copy.
    await expect(run).rejects.toBe(failure);
    expect(await emails()).toEqual(['existing@example.com']);
  });

  it('rolls back when a statement fails in Postgres, and rethrows its error', async () => {
    const run = withTransaction(async (client) => {
      await insertUser(client, 'a@example.com');
      await insertUser(client, 'existing@example.com'); // users.email is UNIQUE, so Postgres fails with code 23505
    });

    await expect(run).rejects.toMatchObject({ code: '23505' });
    expect(await emails()).toEqual(['existing@example.com']);
  });

  it('returns its client to the pool, whether the callback succeeds or throws', async () => {
    await withTransaction(async () => 'ok');
    await withTransaction(async () => {
      throw new Error('boom');
    }).catch(() => {});

    // Every connection the pool has opened is idle again, so none was kept checked out.
    expect(pool.idleCount).toBe(pool.totalCount);
  });
});
