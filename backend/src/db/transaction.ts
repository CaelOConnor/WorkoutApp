import type { PoolClient } from 'pg';
import pool from './pool';

// Runs fn as one transaction: either everything it writes is saved, or nothing is.
// All queries must use the given client, since a transaction lives on one connection.
// On failure it rolls back and rethrows the error, so callers handle it as usual.
// <T>: returns whatever fn returns, with its type.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  // If ROLLBACK fails, the connection may be stuck mid-transaction, so don't reuse it.
  let broken = false;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch((rollbackErr: unknown) => {
      console.error('ROLLBACK failed:', rollbackErr);
      broken = true;
    });
    throw err;
  } finally {
    // Always give the connection back. release(true) closes it instead.
    client.release(broken);
  }
}