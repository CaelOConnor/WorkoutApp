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

// Mounted at /templates. Templates are per user, so every route needs auth.
const templatesRouter = Router();

templatesRouter.use(requireAuth);

// Database errors that are the client's fault when creating or editing a template.
// Returns null for anything else, which becomes a 500.
function templateWriteError(err: unknown, name: string): { status: number; body: ErrorResponse } | null {
  // The unique index is enough here: there are no built-in templates to check against.
  if (isUniqueViolation(err, 'templates_user_id_lower_name_key')) {
    return { status: 409, body: { error: `A template named "${name}" already exists` } };
  }
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
      // All or nothing: a bad exercise undoes the template too.
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

// all your templates, for the Templates tab list.
templatesRouter.get('/', async (req: Request, res: Response<TemplateDetail[]>) => {
  res.json(await listTemplateDetails(getAuthUser(req).id));
});

// one template, for its detail screen (and when you start a workout from it or edit it).
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

// PUT replaces the whole template: name, exercises, order and set counts.
// The edit screen has the whole template anyway, and replacing the list makes reordering simple.
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
      // All or nothing: a bad exercise undoes the rename and the deletes too.
      const found = await withTransaction(async (client) => {
        // Checks ownership and makes edits happen one at a time.
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

// Its exercises are deleted too (cascade). Workouts started from it are copies, so they stay.
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
    return res.status(204).end(); // success, no body
  }
);

export default templatesRouter;