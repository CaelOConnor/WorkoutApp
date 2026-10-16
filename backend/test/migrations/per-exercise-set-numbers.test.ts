import path from 'node:path';
import { Client } from 'pg';
import { runner } from 'node-pg-migrate';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from '../test-env';

// A data migration has to be tested against data written before it ran, which the normal test
// database never has: global-setup runs every migration on empty tables. So this file builds its
// own copy of the schema in a scratch Postgres schema (a namespace for tables inside the same
// database), runs migrations only up to the one before this, inserts old-style rows, then runs
// this migration and checks the result. The app's tables in `public` are never touched.

const SCHEMA = 'migration_test';
const MIGRATION = '1792176885655_per-exercise-set-numbers';
// The previous migration's timestamp (1792088230086_custom-exercises).
const BEFORE_MIGRATION = 1792088230086;
const CONSTRAINT = 'sets_workout_exercise_set_number_key';

// Its own connection rather than the app's pool: the runner sets search_path on the connection
// it's given, so every query below on this client reads and writes the scratch schema.
const client = new Client({ connectionString: TEST_DATABASE_URL });

// The runner options this file varies; the rest are fixed in migrate().
interface MigrateOptions {
  direction: 'up' | 'down';
  count?: number;
  timestamp?: boolean;
  file?: string;
}

async function migrate(options: MigrateOptions): Promise<void> {
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

let exerciseIds: { squat: number; bench: number };
let userId: number;

async function insertRow(sql: string, params: unknown[]): Promise<number> {
  const result = await client.query<{ id: number }>(`${sql} RETURNING id`, params);
  const id = result.rows[0]?.id;
  if (id === undefined) {
    throw new Error('insert returned no row');
  }
  return id;
}

function createWorkout(): Promise<number> {
  return insertRow('INSERT INTO workouts (user_id) VALUES ($1)', [userId]);
}

// Inserts sets in the order given ([exercise id, set_number] each), so ids rise in that order.
async function insertSets(workoutId: number, sets: [number, number][]): Promise<void> {
  for (const [exerciseId, setNumber] of sets) {
    await insertRow(
      'INSERT INTO sets (workout_id, exercise_id, set_number, reps, weight) VALUES ($1, $2, $3, 5, 100)',
      [workoutId, exerciseId, setNumber]
    );
  }
}

// Every set's set_number, in the order the sets were inserted (by id).
async function setNumbers(): Promise<number[]> {
  const result = await client.query<{ set_number: number }>('SELECT set_number FROM sets ORDER BY id');
  return result.rows.map((row) => row.set_number);
}

beforeAll(async () => {
  await client.connect();
});

afterAll(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await client.end();
});

// A fresh scratch schema for each test, migrated to just before this migration.
beforeEach(async () => {
  await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  // timestamp: true makes `count` mean "every migration up to this timestamp" rather than "this many".
  await migrate({ direction: 'up', count: BEFORE_MIGRATION, timestamp: true });

  userId = await insertRow("INSERT INTO users (email, password_hash) VALUES ('a@test.com', 'x')", []);
  exerciseIds = {
    squat: await insertRow("INSERT INTO exercises (name) VALUES ('Squat')", []),
    bench: await insertRow("INSERT INTO exercises (name) VALUES ('Bench')", []),
  };
});

describe(`migration ${MIGRATION}`, () => {
  it('renumbers workout-wide numbers to 1..n per exercise', async () => {
    const { squat, bench } = exerciseIds;
    await insertSets(await createWorkout(), [[squat, 1], [squat, 2], [squat, 3], [bench, 4], [bench, 5]]);

    await migrate({ direction: 'up', file: MIGRATION });

    expect(await setNumbers()).toEqual([1, 2, 3, 1, 2]);
  });

  it('renumbers interleaved exercises separately', async () => {
    const { squat, bench } = exerciseIds;
    await insertSets(await createWorkout(), [[squat, 1], [bench, 2], [squat, 3], [bench, 4]]);

    await migrate({ direction: 'up', file: MIGRATION });

    expect(await setNumbers()).toEqual([1, 1, 2, 2]);
  });

  it('closes gaps left by deleted sets', async () => {
    await insertSets(await createWorkout(), [[exerciseIds.squat, 1], [exerciseIds.squat, 3], [exerciseIds.squat, 7]]);

    await migrate({ direction: 'up', file: MIGRATION });

    expect(await setNumbers()).toEqual([1, 2, 3]);
  });

  it('keeps the order by set_number when it differs from the order sets were added', async () => {
    // Possible before: PATCH could change any set's set_number. The set added second (number 2)
    // was shown first, and stays first.
    await insertSets(await createWorkout(), [[exerciseIds.squat, 5], [exerciseIds.squat, 2], [exerciseIds.squat, 9]]);

    await migrate({ direction: 'up', file: MIGRATION });

    expect(await setNumbers()).toEqual([2, 1, 3]);
  });

  it('breaks a tie between duplicate numbers by the order the sets were added', async () => {
    await insertSets(await createWorkout(), [[exerciseIds.squat, 2], [exerciseIds.squat, 2], [exerciseIds.squat, 5]]);

    await migrate({ direction: 'up', file: MIGRATION });

    expect(await setNumbers()).toEqual([1, 2, 3]);
  });

  it('numbers each workout separately, and leaves an empty workout alone', async () => {
    const { squat } = exerciseIds;
    await insertSets(await createWorkout(), [[squat, 1], [squat, 2]]);
    await createWorkout();
    await insertSets(await createWorkout(), [[squat, 3], [squat, 4]]);

    await migrate({ direction: 'up', file: MIGRATION });

    expect(await setNumbers()).toEqual([1, 2, 1, 2]);
  });

  it('then rejects a second set with the same exercise and number in a workout', async () => {
    const workoutId = await createWorkout();
    await insertSets(workoutId, [[exerciseIds.squat, 1]]);
    await migrate({ direction: 'up', file: MIGRATION });

    // 23505 = unique_violation. The same number for another exercise is still fine.
    await insertSets(workoutId, [[exerciseIds.bench, 1]]);
    await expect(insertSets(workoutId, [[exerciseIds.squat, 1]])).rejects.toMatchObject({
      code: '23505',
      constraint: CONSTRAINT,
    });
  });

  it('checks uniqueness at the end of a statement, so one UPDATE can shift numbers past each other', async () => {
    // Renumbering after a delete shifts sets by one. A plain unique constraint is checked after
    // each row, so moving 1 to 2 would clash with the 2 that hasn't moved yet. A DEFERRABLE one is
    // checked once the whole statement is done, when the numbers are unique again.
    await insertSets(await createWorkout(), [[exerciseIds.squat, 1], [exerciseIds.squat, 2], [exerciseIds.squat, 3]]);
    await migrate({ direction: 'up', file: MIGRATION });

    await client.query('UPDATE sets SET set_number = set_number + 1');

    expect(await setNumbers()).toEqual([2, 3, 4]);
  });

  it('can be rolled back and run again', async () => {
    const workoutId = await createWorkout();
    await insertSets(workoutId, [[exerciseIds.squat, 1]]);
    await migrate({ direction: 'up', file: MIGRATION });

    await migrate({ direction: 'down', count: 1 });
    // The constraint is gone, so a duplicate saves again.
    await insertSets(workoutId, [[exerciseIds.squat, 1]]);

    await migrate({ direction: 'up', file: MIGRATION });
    expect(await setNumbers()).toEqual([1, 2]);
  });
});
