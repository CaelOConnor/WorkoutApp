import type { PoolClient } from 'pg';
import pool from './pool';
import type { Template, TemplateBody, TemplateDetail, TemplateDetailExercise } from '../types/models';

type TemplateColumns = Pick<Template, 'id' | 'name'>;

// Loads all the templates' exercises in one query and nests them (same as attachSets in workoutDetail.ts).
async function attachExercises(templates: TemplateColumns[]): Promise<TemplateDetail[]> {
  if (templates.length === 0) {
    return [];
  }
  const result = await pool.query<TemplateDetailExercise & { template_id: number }>(
    `SELECT te.template_id, te.exercise_id, e.name AS exercise_name, te.set_count
     FROM template_exercises te
     JOIN exercises e ON e.id = te.exercise_id
     WHERE te.template_id = ANY($1::int[])
     ORDER BY te.template_id, te.position`,
    [templates.map((t) => t.id)]
  );

  const exercisesByTemplate = new Map<number, TemplateDetailExercise[]>();
  for (const { template_id, ...exercise } of result.rows) {
    const list = exercisesByTemplate.get(template_id) ?? [];
    list.push(exercise);
    exercisesByTemplate.set(template_id, list);
  }
  return templates.map((template) => ({ ...template, exercises: exercisesByTemplate.get(template.id) ?? [] }));
}

// One template, or null if it doesn't exist or isn't this user's.
export async function loadTemplateDetail(id: number, userId: number): Promise<TemplateDetail | null> {
  const result = await pool.query<TemplateColumns>('SELECT id, name FROM templates WHERE id = $1 AND user_id = $2', [
    id,
    userId,
  ]);
  const template = result.rows[0];
  if (!template) {
    return null;
  }
  const [detail] = await attachExercises([template]);
  return detail ?? null;
}

// All of a user's templates, alphabetical ignoring case.
export async function listTemplateDetails(userId: number): Promise<TemplateDetail[]> {
  const result = await pool.query<TemplateColumns>(
    'SELECT id, name FROM templates WHERE user_id = $1 ORDER BY lower(name), id',
    [userId]
  );
  return attachExercises(result.rows);
}

// Same as lockWorkout, for templates. An edit deletes and re-inserts all of a template's
// exercises, so two edits at once would both insert and collide. Also checks ownership.
export async function lockTemplate(client: PoolClient, templateId: number, userId: number): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM templates WHERE id = $1 AND user_id = $2 FOR UPDATE', [
    templateId,
    userId,
  ]);
  return result.rowCount === 1;
}

// Inserts all of a template's exercises in one query, in the order given. Use inside a transaction.
// unnest pairs up the two arrays into rows; WITH ORDINALITY numbers them 1, 2, 3 for the position.
export async function insertTemplateExercises(
  client: PoolClient,
  templateId: number,
  exercises: TemplateBody['exercises']
): Promise<void> {
  await client.query(
    `INSERT INTO template_exercises (template_id, exercise_id, position, set_count)
     SELECT $1, e.exercise_id, e.position, e.set_count
     FROM unnest($2::int[], $3::int[]) WITH ORDINALITY AS e (exercise_id, set_count, position)`,
    [templateId, exercises.map((e) => e.exercise_id), exercises.map((e) => e.set_count)]
  );
}