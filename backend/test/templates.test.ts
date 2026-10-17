import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/app';
import { authHeader } from './tokens';
import { createExercise, createUser, pool, resetDb } from './db';
import type { PublicUser, TemplateBody, TemplateDetail } from '../src/types/models';

afterAll(async () => {
  await pool.end();
});

let lifter: PublicUser;
let other: PublicUser;
let squat: number;
let bench: number;

beforeEach(async () => {
  await resetDb();
  lifter = await createUser('lifter@example.com', 'password');
  other = await createUser('other@example.com', 'password');
  squat = (await createExercise('Squat')).id;
  bench = (await createExercise('Bench Press')).id;
});

// `object` (not TemplateBody) so tests can send malformed bodies.
function post(body: object, userId = lifter.id) {
  return request(app).post('/templates').set('Authorization', authHeader(userId)).send(body);
}

// Creates a template through the API and returns it, for tests about reading templates.
async function createTemplate(body: TemplateBody, userId = lifter.id): Promise<TemplateDetail> {
  const res = await post(body, userId);
  expect(res.status).toBe(201);
  // res.body is `any` in supertest's types; annotating the return type gives callers a real type.
  return res.body;
}

async function templateCount(): Promise<number> {
  const result = await pool.query('SELECT 1 FROM templates');
  return result.rowCount ?? 0;
}

describe('POST /templates', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/templates')
      .send({ name: 'Leg day', exercises: [{ exercise_id: squat, set_count: 3 }] });

    expect(res.status).toBe(401);
  });

  it('creates a template with the name trimmed and the exercises in the order sent, and returns 201', async () => {
    const res = await post({
      name: '  Leg day ',
      exercises: [
        { exercise_id: bench, set_count: 4 },
        { exercise_id: squat, set_count: 3 },
      ],
    });

    expect(res.status).toBe(201);
    const expected: TemplateDetail = {
      id: expect.any(Number),
      name: 'Leg day',
      exercises: [
        { exercise_id: bench, exercise_name: 'Bench Press', set_count: 4 },
        { exercise_id: squat, exercise_name: 'Squat', set_count: 3 },
      ],
    };
    expect(res.body).toEqual(expected);
  });

  it("accepts the caller's own custom exercise", async () => {
    const lunge = (await createExercise('My Lunge', lifter.id)).id;

    const res = await post({ name: 'Leg day', exercises: [{ exercise_id: lunge, set_count: 2 }] });

    expect(res.status).toBe(201);
    expect(res.body.exercises).toEqual([{ exercise_id: lunge, exercise_name: 'My Lunge', set_count: 2 }]);
  });

  it('returns 400 for an exercise that does not exist, and saves nothing', async () => {
    const res = await post({
      name: 'Leg day',
      exercises: [
        { exercise_id: squat, set_count: 3 },
        { exercise_id: 99999, set_count: 3 },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unknown exercise_id' });
    // The template row went in first; the transaction rolled it back with the failed exercise.
    expect(await templateCount()).toBe(0);
  });

  it("returns the same 400 for another user's custom exercise, without its name", async () => {
    const theirs = (await createExercise('Their Lunge', other.id)).id;

    const res = await post({ name: 'Leg day', exercises: [{ exercise_id: theirs, set_count: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Unknown exercise_id' });
    expect(await templateCount()).toBe(0);
  });

  it('accepts a name of 100 characters counted as Postgres does, so 100 emoji fit', async () => {
    // Each 💪 is one code point but two UTF-16 units, so its .length in JS is 200.
    const res = await post({ name: '💪'.repeat(100), exercises: [{ exercise_id: squat, set_count: 1 }] });

    expect(res.status).toBe(201);
  });

  // it.each with an array of [label, name] tuples: each row becomes its own test, and %s puts
  // the label in the test's name.
  it.each([
    ['missing', undefined],
    ['not a string', 42],
    ['empty', ''],
    ['only spaces', '   '],
    ['over 100 characters', 'x'.repeat(101)],
  ])('returns 400 with a message for a name that is %s', async (_label, name) => {
    const res = await post({ name, exercises: [{ exercise_id: squat, set_count: 3 }] });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Template names must be 1 to 100 characters' });
  });

  it.each([
    ['a body that is an array', []],
    ['no exercises key', { name: 'Leg day' }],
    ['exercises not an array', { name: 'Leg day', exercises: {} }],
    ['no exercises', { name: 'Leg day', exercises: [] }],
    ['an unknown top-level key', { name: 'Leg day', exercises: [{ exercise_id: 1, set_count: 3 }], notes: 'x' }],
    ['an exercise that is not an object', { name: 'Leg day', exercises: [1] }],
    ['an unknown key in an exercise', { name: 'Leg day', exercises: [{ exercise_id: 1, set_count: 3, reps: 5 }] }],
    ['a missing set_count', { name: 'Leg day', exercises: [{ exercise_id: 1 }] }],
    ['a set_count of 0', { name: 'Leg day', exercises: [{ exercise_id: 1, set_count: 0 }] }],
    ['a set_count of 21', { name: 'Leg day', exercises: [{ exercise_id: 1, set_count: 21 }] }],
    ['a fractional set_count', { name: 'Leg day', exercises: [{ exercise_id: 1, set_count: 2.5 }] }],
    ['a set_count as a string', { name: 'Leg day', exercises: [{ exercise_id: 1, set_count: '3' }] }],
    ['an exercise_id of 0', { name: 'Leg day', exercises: [{ exercise_id: 0, set_count: 3 }] }],
    ['an exercise_id too big for INTEGER', { name: 'Leg day', exercises: [{ exercise_id: 2147483648, set_count: 3 }] }],
  ])('returns 400 for %s', async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid template body' });
    expect(await templateCount()).toBe(0);
  });

  it('returns 400 for the same exercise twice', async () => {
    // Real ids, so only the duplicate is wrong.
    const res = await post({
      name: 'Leg day',
      exercises: [
        { exercise_id: squat, set_count: 3 },
        { exercise_id: squat, set_count: 2 },
      ],
    });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid template body' });
  });

  it('returns 409 for a name the caller already uses, ignoring case and surrounding spaces', async () => {
    await createTemplate({ name: 'Leg day', exercises: [{ exercise_id: squat, set_count: 3 }] });

    const res = await post({ name: ' LEG DAY ', exercises: [{ exercise_id: bench, set_count: 3 }] });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'A template named "LEG DAY" already exists' });
    expect(await templateCount()).toBe(1);
  });

  it('allows a name another user already uses', async () => {
    await createTemplate({ name: 'Leg day', exercises: [{ exercise_id: squat, set_count: 3 }] }, other.id);

    const res = await post({ name: 'Leg day', exercises: [{ exercise_id: squat, set_count: 3 }] });

    expect(res.status).toBe(201);
  });

  it('creates only one of two identical requests sent at once, and returns 409 for the other', async () => {
    const body = { name: 'Leg day', exercises: [{ exercise_id: squat, set_count: 3 }] };

    // Promise.all sends both before awaiting either. Both inserts race for the same name; the
    // unique index lets one commit and makes the other fail with 23505.
    const results = await Promise.all([post(body), post(body)]);

    expect(results.map((res) => res.status).sort()).toEqual([201, 409]);
    expect(await templateCount()).toBe(1);
  });
});

describe('GET /templates', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/templates');

    expect(res.status).toBe(401);
  });

  it('returns [] when the caller has no templates', async () => {
    const res = await request(app).get('/templates').set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns only the caller's templates, by name ignoring case, each with its exercises in order", async () => {
    const push = await createTemplate({
      name: 'push',
      exercises: [{ exercise_id: bench, set_count: 5 }],
    });
    const legs = await createTemplate({
      name: 'Leg day',
      exercises: [
        { exercise_id: squat, set_count: 3 },
        { exercise_id: bench, set_count: 2 },
      ],
    });
    await createTemplate({ name: 'Arms', exercises: [{ exercise_id: bench, set_count: 3 }] }, other.id);

    const res = await request(app).get('/templates').set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    // By name, so "Leg day" (created second) comes first. Case is covered by the next test.
    const expected: TemplateDetail[] = [legs, push];
    expect(res.body).toEqual(expected);
  });

  it('sorts names ignoring case', async () => {
    await createTemplate({ name: 'arms', exercises: [{ exercise_id: bench, set_count: 3 }] });
    await createTemplate({ name: 'Zercher day', exercises: [{ exercise_id: squat, set_count: 3 }] });
    await createTemplate({ name: 'Back', exercises: [{ exercise_id: bench, set_count: 3 }] });

    const res = await request(app).get('/templates').set('Authorization', authHeader(lifter.id));

    expect(res.body.map((t: TemplateDetail) => t.name)).toEqual(['arms', 'Back', 'Zercher day']);
  });
});

describe('GET /templates/:id', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/templates/1');

    expect(res.status).toBe(401);
  });

  it('returns one of the caller\'s templates', async () => {
    const legs = await createTemplate({
      name: 'Leg day',
      exercises: [
        { exercise_id: squat, set_count: 3 },
        { exercise_id: bench, set_count: 2 },
      ],
    });

    const res = await request(app).get(`/templates/${legs.id}`).set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(200);
    expect(res.body).toEqual(legs);
  });

  it("returns 404 for another user's template, the same as for a missing one", async () => {
    const theirs = await createTemplate(
      { name: 'Leg day', exercises: [{ exercise_id: squat, set_count: 3 }] },
      other.id
    );

    const res = await request(app).get(`/templates/${theirs.id}`).set('Authorization', authHeader(lifter.id));
    const missing = await request(app).get('/templates/99999').set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Template not found' });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: 'Template not found' });
  });

  it.each(['abc', '0', '-1', '1.5'])('returns 400 for the id %s', async (id) => {
    const res = await request(app).get(`/templates/${id}`).set('Authorization', authHeader(lifter.id));

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid template id' });
  });
});
