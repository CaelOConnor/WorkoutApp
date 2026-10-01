import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Client } from 'pg';
import { TEST_DATABASE_URL } from './test-env';

// Vitest runs this once, in the main process, before any test file.
// It rebuilds the test database from schema.sql so tests always see the current schema.
export default async function globalSetup(): Promise<void> {
  // Guard: this drops every table, so refuse anything that isn't clearly a test database.
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
    const schema = await readFile(path.join(__dirname, '../db/init/schema.sql'), 'utf8');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await client.query(schema);
  } finally {
    await client.end();
  }
}
