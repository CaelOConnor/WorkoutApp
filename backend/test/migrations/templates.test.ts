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
// It only adds tables, so there's no old data to convert: these tests pin down the constraints.

const MIGRATION = '1792254256418_templates';
// The previous migration's timestamp (1792179395895_workout-exercises).
const BEFORE_MIGRATION = 1792179395895;

const client = scratchClient();
const migrate = (options: MigrateOptions) => migrateWith(client, options);
const insertRow = (sql: string, params: unknown[]) => insertRowWith(client, sql, params);

let userId: number;
let otherUserId: number;
let exerciseIds: { squat: number; bench: number };

function createTemplate(ownerId: number, name: string): Promise<number> {
  return insertRow('INSERT INTO templates (user_id, name) VALUES ($1, $2)', [ownerId, name]);
}

// template_exercises has no id column, so this doesn't go through insertRow (which RETURNs id).
async function addExercise(templateId: number, exerciseId: number, position: number, setCount = 3): Promise<void> {
  await client.query(
    'INSERT INTO template_exercises (template_id, exercise_id, position, set_count) VALUES ($1, $2, $3, $4)',
    [templateId, exerciseId, position, setCount]
  );
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
  otherUserId = await insertRow("INSERT INTO users (email, password_hash) VALUES ('b@test.com', 'x')", []);
  exerciseIds = {
    squat: await insertRow("INSERT INTO exercises (name) VALUES ('Squat')", []),
    bench: await insertRow("INSERT INTO exercises (name) VALUES ('Bench')", []),
  };
  await migrate({ direction: 'up', file: MIGRATION });
});

describe(`migration ${MIGRATION}`, () => {
  it("stores a template's exercises with a position and a set count", async () => {
    const templateId = await createTemplate(userId, 'Leg day');
    await addExercise(templateId, exerciseIds.bench, 1, 4);
    await addExercise(templateId, exerciseIds.squat, 2, 3);

    const result = await client.query(
      'SELECT exercise_id, position, set_count FROM template_exercises WHERE template_id = $1 ORDER BY position',
      [templateId]
    );
    expect(result.rows).toEqual([
      { exercise_id: exerciseIds.bench, position: 1, set_count: 4 },
      { exercise_id: exerciseIds.squat, position: 2, set_count: 3 },
    ]);
  });

  it('allows one name per user, ignoring case', async () => {
    await createTemplate(userId, 'Leg day');

    // 23505 = unique_violation.
    await expect(createTemplate(userId, 'LEG DAY')).rejects.toMatchObject({
      code: '23505',
      constraint: 'templates_user_id_lower_name_key',
    });
    // Another user can use the same name.
    await expect(createTemplate(otherUserId, 'Leg day')).resolves.toEqual(expect.any(Number));
  });

  it('allows each exercise once per template', async () => {
    const templateId = await createTemplate(userId, 'Leg day');
    await addExercise(templateId, exerciseIds.squat, 1);

    await expect(addExercise(templateId, exerciseIds.squat, 2)).rejects.toMatchObject({
      code: '23505',
      constraint: 'template_exercises_pkey',
    });
  });

  it('allows one exercise per position', async () => {
    const templateId = await createTemplate(userId, 'Leg day');
    await addExercise(templateId, exerciseIds.squat, 1);

    await expect(addExercise(templateId, exerciseIds.bench, 1)).rejects.toMatchObject({
      code: '23505',
      constraint: 'template_exercises_template_id_position_key',
    });
  });

  // it.each runs the same test once per value; %i puts the value in the test's name.
  it.each([0, 21])('rejects a set count of %i (must be 1 to 20)', async (setCount) => {
    const templateId = await createTemplate(userId, 'Leg day');

    // 23514 = check_violation.
    await expect(addExercise(templateId, exerciseIds.squat, 1, setCount)).rejects.toMatchObject({
      code: '23514',
      constraint: 'template_exercises_set_count_check',
    });
  });

  it("deletes a template's exercises along with the template", async () => {
    const templateId = await createTemplate(userId, 'Leg day');
    await addExercise(templateId, exerciseIds.squat, 1);

    await client.query('DELETE FROM templates WHERE id = $1', [templateId]);

    expect((await client.query('SELECT * FROM template_exercises')).rows).toEqual([]);
  });

  it("accepts a built-in exercise or the owner's own custom one", async () => {
    const mine = await insertRow("INSERT INTO exercises (name, created_by) VALUES ('My Lunge', $1)", [userId]);
    const templateId = await createTemplate(userId, 'Leg day');

    await addExercise(templateId, exerciseIds.squat, 1);
    await addExercise(templateId, mine, 2);

    expect((await client.query('SELECT 1 FROM template_exercises')).rowCount).toBe(2);
  });

  it("rejects another user's custom exercise", async () => {
    const theirs = await insertRow("INSERT INTO exercises (name, created_by) VALUES ('Their Lunge', $1)", [
      otherUserId,
    ]);
    const templateId = await createTemplate(userId, 'Leg day');

    // The same error code as the sets trigger, so the routes can turn both into a 400.
    await expect(addExercise(templateId, theirs, 1)).rejects.toMatchObject({
      code: '23503',
      constraint: 'template_exercises_exercise_visible',
    });
  });

  it("rejects moving a row to another user's template when its exercise isn't theirs", async () => {
    // The trigger also runs on UPDATE: a custom exercise allowed in its owner's template mustn't
    // end up in someone else's.
    const mine = await insertRow("INSERT INTO exercises (name, created_by) VALUES ('My Lunge', $1)", [userId]);
    const myTemplate = await createTemplate(userId, 'Leg day');
    const theirTemplate = await createTemplate(otherUserId, 'Leg day');
    await addExercise(myTemplate, mine, 1);

    await expect(
      client.query('UPDATE template_exercises SET template_id = $1 WHERE template_id = $2', [theirTemplate, myTemplate])
    ).rejects.toMatchObject({ code: '23503', constraint: 'template_exercises_exercise_visible' });
  });

  it('keeps an exercise from being deleted while a template uses it', async () => {
    // No cascade from exercises: deleting a custom exercise (not built yet) has to decide what
    // happens to the templates that use it, as it does for sets.
    const templateId = await createTemplate(userId, 'Leg day');
    await addExercise(templateId, exerciseIds.squat, 1);

    await expect(client.query('DELETE FROM exercises WHERE id = $1', [exerciseIds.squat])).rejects.toMatchObject({
      code: '23503',
      constraint: 'template_exercises_exercise_id_fkey',
    });
  });

  it('can be rolled back and run again', async () => {
    await migrate({ direction: 'down', count: 1 });
    expect((await client.query("SELECT to_regclass('templates') AS t")).rows).toEqual([{ t: null }]);
    // to_regprocedure, like to_regclass, looks the name up through search_path (the scratch
    // schema), so the copy global-setup made in public doesn't count.
    expect(
      (await client.query("SELECT to_regprocedure('template_exercises_check_exercise_visible()') AS f")).rows
    ).toEqual([{ f: null }]);

    await migrate({ direction: 'up', file: MIGRATION });
    await expect(createTemplate(userId, 'Leg day')).resolves.toEqual(expect.any(Number));
  });
});
