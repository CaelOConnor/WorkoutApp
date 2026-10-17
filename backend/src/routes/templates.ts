import { Router, type Request, type Response } from 'express';
import pool from '../db/pool';
import { isUniqueViolation, isUnknownExerciseError } from '../db/errors';
import {
  insertTemplateExercises,
  listTemplateDetails,
  loadTemplateDetail,
  lockTemplate,
} from '../db/templates';
import { withTransaction } from '../db/transaction';
import { getAuthUser, requireAuth } from '../middleware/auth';
import { parseId, parseTemplateBody } from '../validation';
import type { ErrorResponse, Template, TemplateDetail } from '../types/models';
import type { NoParams } from './types';

// Mounted at /templates in app.ts. Templates are per user, so auth runs on the whole router, and
// every query filters on the caller's user_id: another user's template is a 404, like a missing one.
const templatesRouter = Router();

templatesRouter.use(requireAuth);

// The client errors a template write (POST or PUT) can hit in the database, as a status and body,
// or null for anything else (which the route rethrows, for a 500).
function templateWriteError(err: unknown, name: string): { status: number; body: ErrorResponse } | null {
  // The unique index on (user_id, lower(name)) is the only duplicate check: unlike exercises,
  // there are no built-in templates whose names would also count. It also settles two requests
  // for one name at once, since only one of them can commit it. A PUT that keeps its own name
  // doesn't clash: the index compares against the other rows, not the one being updated.
  if (isUniqueViolation(err, 'templates_user_id_lower_name_key')) {
    return { status: 409, body: { error: `A template named "${name}" already exists` } };
  }
  // A missing exercise, or another user's custom one (template_exercises_exercise_visible):
  // the same 400, so the id doesn't reveal which.
  if (isUnknownExerciseError(err)) {
    return { status: 400, body: { error: 'Unknown exercise_id' } };
  }
  return null;
}

templatesRouter.post(
  '/',
  async (
    req: Request<NoParams, TemplateDetail | ErrorResponse, unknown>,
    res: Response<TemplateDetail | ErrorResponse>
  ) => {
    const parsed = parseTemplateBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    const { name, exercises } = parsed.value;
    const user = getAuthUser(req);

    try {
      // One transaction: if an exercise is rejected, the template row goes too.
      const templateId = await withTransaction(async (client) => {
        const result = await client.query<Pick<Template, 'id'>>(
          'INSERT INTO templates (user_id, name) VALUES ($1, $2) RETURNING id',
          [user.id, name]
        );
        const template = result.rows[0];
        if (!template) {
          throw new Error('Template insert returned no row');
        }
        await insertTemplateExercises(client, template.id, exercises);
        return template.id;
      });

      const detail = await loadTemplateDetail(templateId, user.id);
      if (!detail) {
        throw new Error('Created template not found');
      }
      return res.status(201).json(detail);
    } catch (err: unknown) {
      const clientError = templateWriteError(err, name);
      if (clientError) {
        return res.status(clientError.status).json(clientError.body);
      }
      throw err;
    }
  }
);

templatesRouter.get('/', async (req: Request, res: Response<TemplateDetail[]>) => {
  res.json(await listTemplateDetails(getAuthUser(req).id));
});

templatesRouter.get(
  '/:id',
  async (req: Request<{ id: string }>, res: Response<TemplateDetail | ErrorResponse>) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid template id' });
    }
    const template = await loadTemplateDetail(id, getAuthUser(req).id);
    if (!template) {
      return res.status(404).json({ error: 'Template not found' });
    }
    return res.json(template);
  }
);

// Replaces the whole template: its name, and its exercise list (order, which exercises, set counts).
// The edit screen holds the whole template anyway, and replacing every row at positions 1..n means
// a reorder never swaps two positions in place.
templatesRouter.put(
  '/:id',
  async (
    req: Request<{ id: string }, TemplateDetail | ErrorResponse, unknown>,
    res: Response<TemplateDetail | ErrorResponse>
  ) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid template id' });
    }
    const parsed = parseTemplateBody(req.body);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }
    const { name, exercises } = parsed.value;
    const user = getAuthUser(req);

    try {
      // All or nothing: if the new list has an unknown exercise, the rename and the deleted rows
      // roll back too.
      const found = await withTransaction(async (client) => {
        // The UPDATE below would lock the template row too (an UPDATE locks the rows it changes),
        // but locking first says so explicitly, doubles as the ownership check, and keeps edits
        // one at a time even if the UPDATE later moves or is skipped when the name is unchanged.
        if (!(await lockTemplate(client, id, user.id))) {
          return false;
        }
        await client.query('UPDATE templates SET name = $1 WHERE id = $2', [name, id]);
        await client.query('DELETE FROM template_exercises WHERE template_id = $1', [id]);
        await insertTemplateExercises(client, id, exercises);
        return true;
      });
      if (!found) {
        return res.status(404).json({ error: 'Template not found' });
      }

      const detail = await loadTemplateDetail(id, user.id);
      if (!detail) {
        throw new Error('Updated template not found');
      }
      return res.json(detail);
    } catch (err: unknown) {
      const clientError = templateWriteError(err, name);
      if (clientError) {
        return res.status(clientError.status).json(clientError.body);
      }
      throw err;
    }
  }
);

// Its exercise rows go with it (ON DELETE CASCADE). Workouts started from it are copies, so
// they're untouched. One statement, so no transaction or lock is needed.
templatesRouter.delete(
  '/:id',
  async (req: Request<{ id: string }>, res: Response<ErrorResponse>) => {
    const id = parseId(req.params.id);
    if (id === null) {
      return res.status(400).json({ error: 'Invalid template id' });
    }
    const result = await pool.query('DELETE FROM templates WHERE id = $1 AND user_id = $2', [
      id,
      getAuthUser(req).id,
    ]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Template not found' });
    }
    // 204 No Content: success with no body. end() sends it without one.
    return res.status(204).end();
  }
);

export default templatesRouter;
