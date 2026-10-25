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

const MIGRATION = '1792179395895_workout-exercises';
// The previous migration's timestamp (1792176885655_per-exercise-set-numbers).
const BEFORE_MIGRATION = 1792176885655;

const client = scratchClient();
const migrate = (options: MigrateOptions) => migrateWith(client, options);
const insertRow = (sql: string, params: unknown[]) => insertRowWith(client, sql, params);

let userId: number;
let exerciseIds: { squat: number; bench: number; row: number };

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

// One workout's exercises as [exercise id, position], by position.
async function positionsOf(workoutId: number): Promise<[number, number][]> {
  const result = await client.query<{ exercise_id: number; position: number }>(
    'SELECT exercise_id, position FROM workout_exercises WHERE workout_id = $1 ORDER BY position',
    [workoutId]
  );
  return result.rows.map((row) => [row.exercise_id, row.position]);
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
  userId = await insertRow("INSERT INTO users (email, password_hash) VALUES ('a@test.com', 'x')", []);
  exerciseIds = {
    squat: await insertRow("INSERT INTO exercises (name) VALUES ('Squat')", []),
    bench: await insertRow("INSERT INTO exercises (name) VALUES ('Bench')", []),
    row: await insertRow("INSERT INTO exercises (name) VALUES ('Row')", []),
  };
});

describe(`migration ${MIGRATION}`, () => {
  it("records each workout's exercises in the order the API showed them: by each one's oldest set", async () => {
    const { squat, bench, row } = exerciseIds;
    // Row first, then Bench, then Squat; Row's second set comes after all of them.
    const first = await createWorkout();
    await insertSets(first, [[row, 1], [bench, 1], [squat, 1], [row, 2]]);
    const empty = await createWorkout();
    const second = await createWorkout();
    await insertSets(second, [[squat, 1], [squat, 2], [bench, 1]]);

    await migrate({ direction: 'up', file: MIGRATION });

    expect(await positionsOf(first)).toEqual([[row, 1], [bench, 2], [squat, 3]]);
    expect(await positionsOf(empty)).toEqual([]);
    expect(await positionsOf(second)).toEqual([[squat, 1], [bench, 2]]);
  });

  describe('after it runs', () => {
    let workoutId: number;

    beforeEach(async () => {
      workoutId = await createWorkout();
      await insertSets(workoutId, [[exerciseIds.squat, 1], [exerciseIds.squat, 2]]);
      await migrate({ direction: 'up', file: MIGRATION });
    });

    it('rejects a set whose exercise is not one of the workout exercises', async () => {
      // 23503 is foreign_key_violation: (workout_id, exercise_id) must be a workout_exercises row.
      await expect(insertSets(workoutId, [[exerciseIds.bench, 1]])).rejects.toMatchObject({
        code: '23503',
        constraint: 'sets_workout_exercise_fkey',
      });
    });

    it("deletes an exercise's sets along with its workout_exercises row", async () => {
      await client.query('DELETE FROM workout_exercises WHERE workout_id = $1 AND exercise_id = $2', [
        workoutId,
        exerciseIds.squat,
      ]);

      expect((await client.query('SELECT id FROM sets')).rows).toEqual([]);
    });

    it("deletes a workout's exercises along with the workout", async () => {
      await client.query('DELETE FROM workouts WHERE id = $1', [workoutId]);

      expect((await client.query('SELECT * FROM workout_exercises')).rows).toEqual([]);
    });

    it('allows one position per workout', async () => {
      await expect(
        client.query('INSERT INTO workout_exercises (workout_id, exercise_id, position) VALUES ($1, $2, 1)', [
          workoutId,
          exerciseIds.bench,
        ])
      ).rejects.toMatchObject({ code: '23505', constraint: 'workout_exercises_workout_id_position_key' });
    });

    it("rejects another user's custom exercise, like a set of it", async () => {
      const otherId = await insertRow("INSERT INTO users (email, password_hash) VALUES ('b@test.com', 'x')", []);
      const theirs = await insertRow("INSERT INTO exercises (name, created_by) VALUES ('Their Lunge', $1)", [otherId]);

      await expect(
        client.query('INSERT INTO workout_exercises (workout_id, exercise_id, position) VALUES ($1, $2, 2)', [
          workoutId,
          theirs,
        ])
      ).rejects.toMatchObject({ code: '23503', constraint: 'sets_exercise_visible' });
    });

    it('can be rolled back and run again', async () => {
      await migrate({ direction: 'down', count: 1 });
      expect(
        (await client.query("SELECT to_regclass('workout_exercises') AS t")).rows
      ).toEqual([{ t: null }]);

      await migrate({ direction: 'up', file: MIGRATION });
      expect(await positionsOf(workoutId)).toEqual([[exerciseIds.squat, 1]]);
    });
  });
});
