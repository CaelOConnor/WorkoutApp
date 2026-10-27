import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  dropScratchSchema,
  insertRow as insertRowWith,
  migrate as migrateWith,
  resetScratchSchema,
  scratchClient,
  type MigrateOptions,
} from './scratch-schema';

// Tested in a scratch schema migrated to just before this migration (see scratch-schema.ts).

const MIGRATION = '1793120084802_normalize-emails';
// The previous migration's timestamp (1792254256418_templates).
const BEFORE_MIGRATION = 1792254256418;

const client = scratchClient();
const migrate = (options: MigrateOptions) => migrateWith(client, options);
const insertRow = (sql: string, params: unknown[]) => insertRowWith(client, sql, params);

function createUser(email: string): Promise<number> {
  return insertRow("INSERT INTO users (email, password_hash) VALUES ($1, 'x')", [email]);
}

async function emails(): Promise<string[]> {
  const result = await client.query<{ email: string }>('SELECT email FROM users ORDER BY id');
  return result.rows.map((row) => row.email);
}

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await dropScratchSchema(client);
  await client.end();
});

beforeEach(async () => {
  await resetScratchSchema(client, BEFORE_MIGRATION);
});

describe(`migration ${MIGRATION}`, () => {
  it('trims and lowercases existing emails', async () => {
    await createUser(' Cael@Test.com ');
    await createUser('already@test.com');

    await migrate({ direction: 'up', file: MIGRATION });

    expect(await emails()).toEqual(['cael@test.com', 'already@test.com']);
  });

  it('fails, changing nothing, when two emails would become the same', async () => {
    await createUser('Cael@Test.com');
    await createUser('cael@test.com');

    // 23505 = unique_violation. The runner leaves its failed transaction open on a client it was
    // given, so roll it back here, as closing the connection would in a real run.
    await expect(migrate({ direction: 'up', file: MIGRATION })).rejects.toMatchObject({ code: '23505' });
    await client.query('ROLLBACK');
    expect(await emails()).toEqual(['Cael@Test.com', 'cael@test.com']);
  });

  it('can be rolled back and run again', async () => {
    await createUser('Cael@Test.com');
    await migrate({ direction: 'up', file: MIGRATION });

    await migrate({ direction: 'down', count: 1 });
    // The original spelling is gone for good, so rolling back leaves emails as they are.
    expect(await emails()).toEqual(['cael@test.com']);

    await migrate({ direction: 'up', file: MIGRATION });
    expect(await emails()).toEqual(['cael@test.com']);
  });
});
