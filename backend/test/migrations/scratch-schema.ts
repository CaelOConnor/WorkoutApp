import path from 'node:path';
import { Client } from 'pg';
import { runner } from 'node-pg-migrate';
import { TEST_DATABASE_URL } from '../test-env';

// Shared setup for migration tests. A data migration has to be tested against data written before
// it ran, which the normal test database never has: global-setup runs every migration on empty
// tables. So each migration test builds its own copy of the schema in a scratch Postgres schema (a
// namespace for tables inside the same database), runs migrations only up to the one before the
// migration under test, inserts old-style rows, then runs that migration and checks the result.
// The app's tables in `public` are never touched.

export const SCHEMA = 'migration_test';

// Its own connection rather than the app's pool: the runner sets search_path on the connection
// it's given, so every query on this client reads and writes the scratch schema.
export function scratchClient(): Client {
  return new Client({ connectionString: TEST_DATABASE_URL });
}

// The runner options a test varies; the rest are fixed below.
export interface MigrateOptions {
  direction: 'up' | 'down';
  count?: number;
  timestamp?: boolean;
  file?: string;
}

export async function migrate(client: Client, options: MigrateOptions): Promise<void> {
  await runner({
    dbClient: client,
    dir: path.join(__dirname, '../../migrations'),
    migrationsTable: 'pgmigrations',
    schema: SCHEMA,
    createSchema: true,
    log: () => {},
    ...options,
  });
}

// A fresh scratch schema with every migration up to and including the one with this timestamp.
// timestamp: true makes `count` mean "every migration up to this timestamp" rather than "this many".
export async function resetScratchSchema(client: Client, upToTimestamp: number): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await migrate(client, { direction: 'up', count: upToTimestamp, timestamp: true });
}

export async function dropScratchSchema(client: Client): Promise<void> {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
}

// Runs an INSERT and returns the new row's id.
export async function insertRow(client: Client, sql: string, params: unknown[]): Promise<number> {
  const result = await client.query<{ id: number }>(`${sql} RETURNING id`, params);
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error('insert returned no row');
  }
  return id;
}
