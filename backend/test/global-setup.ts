import path from 'node:path';
import { Client } from 'pg';
import { runner } from 'node-pg-migrate';
import { TEST_DATABASE_URL } from './test-env';

// Runs once before any test file. Rebuilding from every migration means a migration that
// can't build from scratch fails here, not in production.
export default async function globalSetup(): Promise<void> {
  // This drops every table, so refuse anything that isn't clearly a test database.
  if (!new URL(TEST_DATABASE_URL).pathname.endsWith('_test')) {
    throw new Error(`Refusing to reset a non-test database: ${TEST_DATABASE_URL}`);
  }

  const client = new Client({ connectionString: TEST_DATABASE_URL });
  try {
    await client.connect();
  } catch (err: unknown) {
    throw new Error(
      'Could not connect to the test database. Start it with: docker compose up -d postgres-test',
      { cause: err }
    );
  }

  try {
    // Dropping the schema also drops the pgmigrations tracking table, so every migration reruns.
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await runner({
      // Reuse our connection instead of having node-pg-migrate open another one.
      dbClient: client,
      dir: path.join(__dirname, '../migrations'),
      migrationsTable: 'pgmigrations',
      direction: 'up',
      // Keep test output quiet; errors still throw.
      log: () => {},
    });
  } finally {
    await client.end();
  }
}
