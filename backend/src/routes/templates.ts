import { Router, type Request, type Response } from 'express';
import { isUniqueViolation, isUnknownExerciseError } from '../db/errors';
import { insertTemplateExercises, listTemplateDetails, loadTemplateDetail } from '../db/templates';
import { withTransaction } from '../db/transaction';
import { getAuthUser, requireAuth } from '../middleware/auth';
import { parseId, parseTemplateBody } from '../validation';
import type { ErrorResponse, Template, TemplateDetail } from '../types/models';
import type { NoParams } from './types';

// Mounted at /templates in app.ts. Templates are per user, so auth runs on the whole router, and
// every query filters on the caller's user_id: another user's template is a 404, like a missing one.
const templatesRouter = Router();

templatesRouter.use(requireAuth);

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
      // The unique index on (user_id, lower(name)) is the only duplicate check: unlike exercises,
      // there are no built-in templates whose names would also count. It also settles two
      // identical requests at once, since only one of them can commit the name.
      if (isUniqueViolation(err, 'templates_user_id_lower_name_key')) {
        return res.status(409).json({ error: `A template named "${name}" already exists` });
      }
      // A missing exercise, or another user's custom one (template_exercises_exercise_visible):
      // the same 400, so the id doesn't reveal which.
      if (isUnknownExerciseError(err)) {
        return res.status(400).json({ error: 'Unknown exercise_id' });
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

export default templatesRouter;
