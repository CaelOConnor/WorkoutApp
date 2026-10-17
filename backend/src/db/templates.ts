import type { PoolClient } from 'pg';
import pool from './pool';
import type { Template, TemplateBody, TemplateDetail, TemplateDetailExercise } from '../types/models';

type TemplateColumns = Pick<Template, 'id' | 'name'>;

// Fetches the exercises of every given template in one query and nests them (2 queries in total,
// as in workoutDetail.ts). Each template keeps its position in the input array.
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

// One of the user's templates, or null if it doesn't exist or is someone else's (callers give
// both the same 404, so the response can't reveal that another user's template exists).
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

// All of the user's templates, by name ignoring case ("arms" between "Abs" and "Back"), then id.
export async function listTemplateDetails(userId: number): Promise<TemplateDetail[]> {
  const result = await pool.query<TemplateColumns>(
    'SELECT id, name FROM templates WHERE user_id = $1 ORDER BY lower(name), id',
    [userId]
  );
  return attachExercises(result.rows);
}

// Locks one of the user's templates until the transaction ends, and says whether it was found
// (false for a missing one or another user's, which callers turn into a 404). Same idea as
// lockWorkout: an edit replaces all of a template's exercise rows (DELETE, then INSERT), and two
// edits at once would collide. Under READ COMMITTED, the second edit's DELETE waits on the first's
// locked rows but doesn't see the rows the first then inserts, so its INSERT hits the primary key.
// Locking the template row first makes the second edit wait before it reads anything.
export async function lockTemplate(client: PoolClient, templateId: number, userId: number): Promise<boolean> {
  const result = await client.query('SELECT 1 FROM templates WHERE id = $1 AND user_id = $2 FOR UPDATE', [
    templateId,
    userId,
  ]);
  return result.rowCount === 1;
}

// Writes a template's exercises at positions 1..n, in the order given. Call inside a transaction.
// unnest() turns the two arrays into rows, pairing elements by index (exercise_ids[i] with
// set_counts[i]), and WITH ORDINALITY adds each row's index, counting from 1, which is the position.
// One statement for all of them, rather than one INSERT per exercise.
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
