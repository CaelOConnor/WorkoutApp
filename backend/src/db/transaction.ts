import type { PoolClient } from 'pg';
import pool from './pool';

// Runs `fn` inside BEGIN ... COMMIT on one client from the pool, and returns what `fn` returns.
// Every query in a transaction must go through the same client (a pool may hand each pool.query
// a different connection), so `fn` gets that client and uses it instead of `pool`.
// If `fn` throws, or a query in it fails, everything it wrote is rolled back and the same error is
// rethrown, so callers catch it just as they would an error from pool.query.
// <T> is a generic type parameter: whatever `fn` resolves to (a boolean, an id, ...) is what
// withTransaction resolves to, with no cast at the call site.
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  // A client whose ROLLBACK failed (e.g. the connection dropped) may still be inside the
  // transaction, so it must not go back to the pool for the next request to reuse.
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
    // release(true) closes the connection instead of returning it to the pool.
    client.release(broken);
  }
}
