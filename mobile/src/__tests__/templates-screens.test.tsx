// Integration tests for the template screens: the Templates tab, a template's detail, and the
// shared form behind "+ New template" and Edit. The real app from src/app/, signed in, with a fake
// backend.
import type { CreateExerciseBody, Exercise, TemplateBody, TemplateDetail } from '@shared/models';
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { TOKEN_KEY } from '@/auth/token-storage';
import { recordAlerts } from '@/test-utils/alerts';
import { doubleTap } from '@/test-utils/double-tap';
import {
  jsonResponse,
  mockApi,
  noContentResponse,
  requestsMade,
  type MockRoutes,
} from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');

const EXERCISES: Exercise[] = [
  { id: 1, name: 'Squat', muscle_group: 'Legs', created_by: null },
  { id: 2, name: 'RDL', muscle_group: 'Legs', created_by: null },
  { id: 3, name: 'Leg press', muscle_group: 'Legs', created_by: null },
  { id: 4, name: 'Bench Press', muscle_group: 'Chest', created_by: null },
];

const LEG_DAY: TemplateDetail = {
  id: 1,
  name: 'Leg day',
  exercises: [
    { exercise_id: 1, exercise_name: 'Squat', set_count: 3 },
    { exercise_id: 2, exercise_name: 'RDL', set_count: 3 },
    { exercise_id: 3, exercise_name: 'Leg press', set_count: 4 },
  ],
};

const PUSH_DAY: TemplateDetail = {
  id: 2,
  name: 'Push day',
  exercises: [{ exercise_id: 4, exercise_name: 'Bench Press', set_count: 5 }],
};

// The id POST /templates gives the first new template.
const NEW_ID = 10;

// A backend with the templates routes, behaving like the real ones: the list sorted by name
// ignoring case, 409 for a name already used (ignoring case, except the template's own), 404 for
// a template that isn't there. `holdWrites()` keeps POST and PUT unanswered until the function
// it returns is called.
function fakeServer(initial: TemplateDetail[] = [LEG_DAY, PUSH_DAY]) {
  const templates = [...initial];
  const exercises = [...EXERCISES];
  // Every POST and PUT body, in order.
  const bodies: TemplateBody[] = [];
  let gate: Promise<void> | null = null;

  const notFound = () => jsonResponse(404, { error: 'Template not found' });

  // What the server stores for a body: the trimmed name, and each exercise with its name.
  function fromBody(id: number, body: TemplateBody): TemplateDetail {
    return {
      id,
      name: body.name.trim(),
      exercises: body.exercises.map((e) => ({
        ...e,
        exercise_name: exercises.find((x) => x.id === e.exercise_id)?.name ?? '?',
      })),
    };
  }

  function nameTaken(name: string, exceptId: number | null) {
    return templates.some(
      (t) => t.id !== exceptId && t.name.toLowerCase() === name.trim().toLowerCase()
    );
  }

  const conflict = (name: string) =>
    jsonResponse(409, { error: `A template named "${name.trim()}" already exists` });

  const routes: MockRoutes = {
    // The history, which the app opens on before the test switches tabs.
    'GET /workouts': () => jsonResponse(200, []),
    'GET /templates': () =>
      jsonResponse(
        200,
        [...templates].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()))
      ),
    'GET /exercises': () => jsonResponse(200, exercises),
    'POST /exercises': ({ body }) => {
      // `as`: the fake trusts the app's body, like the other screen tests.
      const { name, muscle_group } = body as CreateExerciseBody;
      const exercise: Exercise = {
        id: 100 + exercises.length,
        name: name.trim(),
        muscle_group: muscle_group ?? null,
        created_by: 1,
      };
      exercises.push(exercise);
      return jsonResponse(201, exercise);
    },
    'POST /templates': async ({ body }) => {
      await gate;
      const templateBody = body as TemplateBody;
      bodies.push(templateBody);
      if (nameTaken(templateBody.name, null)) {
        return conflict(templateBody.name);
      }
      const template = fromBody(NEW_ID + templates.length - initial.length, templateBody);
      templates.push(template);
      return jsonResponse(201, template);
    },
  };

  // GET, PUT and DELETE for every id a test can reach.
  for (const id of [1, 2, NEW_ID]) {
    const index = () => templates.findIndex((t) => t.id === id);
    routes[`GET /templates/${id}`] = () => {
      const template = templates[index()];
      return template ? jsonResponse(200, template) : notFound();
    };
    routes[`PUT /templates/${id}`] = async ({ body }) => {
      await gate;
      const templateBody = body as TemplateBody;
      bodies.push(templateBody);
      const i = index();
      if (i === -1) return notFound();
      if (nameTaken(templateBody.name, id)) return conflict(templateBody.name);
      const template = fromBody(id, templateBody);
      templates[i] = template;
      return jsonResponse(200, template);
    };
    routes[`DELETE /templates/${id}`] = () => {
      const i = index();
      if (i === -1) return notFound();
      templates.splice(i, 1);
      return noContentResponse();
    };
  }

  const fetchMock = mockApi(routes);

  function holdWrites(): () => void {
    let release = () => {};
    gate = new Promise((resolve) => {
      release = resolve;
    });
    return () => {
      gate = null;
      release();
    };
  }

  return { templates, bodies, fetchMock, holdWrites };
}

beforeEach(async () => {
  await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
});

afterEach(() => {
  jest.restoreAllMocks();
  // renderRouter switches to fake timers; switch back so other tests aren't affected.
  jest.useRealTimers();
});

// Starts on the history, like a launch, and opens the Templates tab. Tests then move around by
// tapping, like a user. See auth-screens.test.tsx for why the Promise is awaited separately.
async function openTemplatesTab() {
  const rendered = renderRouter('./src/app', { initialUrl: '/' });
  await rendered;
  await fireEvent.press(
    await screen.findByRole('button', { name: /^Templates, tab, \d+ of \d+$/ })
  );
  await waitFor(() => expect(rendered.getPathname()).toBe('/templates'));
  return { getPathname: () => rendered.getPathname() };
}

// A row of the templates list, by its accessible name ("Leg day · Squat 3 · ...").
function templateRow(name: string) {
  return screen.findByRole('button', { name: new RegExp(`^${name} · `) });
}

// The names of the list's rows, top to bottom.
function rowNames() {
  return screen
    .getAllByRole('button', { name: / · / })
    .map((row) => String(row.props.accessibilityLabel));
}

// Opens a template's detail from the list.
async function openTemplate(app: { getPathname: () => string }, name: string, id: number) {
  await fireEvent.press(await templateRow(name));
  await waitFor(() => expect(app.getPathname()).toBe(`/templates/${id}`));
}

// The detail's exercise lines ("Squat · 3 sets"), top to bottom, once they're on screen.
async function detailLines() {
  await screen.findAllByTestId('template exercise');
  return currentDetailLines();
}

// The same, synchronously, for use inside waitFor (whose callback should not be async).
function currentDetailLines() {
  return screen
    .getAllByTestId('template exercise')
    .map((line) => String(line.props.accessibilityLabel));
}

// The form's exercise cards, top to bottom, by exercise name.
function formOrder() {
  return screen.getAllByTestId(/ card$/).map((card) => String(card.props.testID).replace(/ card$/, ''));
}

// Opens the picker from the form and picks `name`.
async function addExercise(name: string) {
  await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
  await fireEvent.press(await screen.findByRole('button', { name }));
  await screen.findByTestId(`${name} card`);
}

describe('the Templates tab', () => {
  it('lists the templates by name, each with its exercises and set counts', async () => {
    // The server sorts the list; given out of order here to show the app keeps its order.
    fakeServer([PUSH_DAY, LEG_DAY]);
    await openTemplatesTab();

    await templateRow('Leg day');
    expect(rowNames()).toEqual(['Leg day · Squat 3 · RDL 3 · Leg press 4', 'Push day · Bench Press 5']);
  });

  it('says how to make one when there are none, including from a workout', async () => {
    fakeServer([]);
    await openTemplatesTab();

    expect(await screen.findByText('No templates yet')).toBeOnTheScreen();
    expect(screen.getByText(/save a workout as a template/)).toBeOnTheScreen();
  });

  it('shows an error with a retry when the list fails to load', async () => {
    let fail = true;
    mockApi({
      'GET /workouts': () => jsonResponse(200, []),
      'GET /templates': () =>
        fail ? jsonResponse(400, { error: 'Templates are unavailable' }) : jsonResponse(200, [LEG_DAY]),
    });
    await openTemplatesTab();

    expect(await screen.findByText('Templates are unavailable')).toBeOnTheScreen();
    fail = false;
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await templateRow('Leg day')).toBeOnTheScreen();
  });

  it('refetches on pull-to-refresh', async () => {
    const { templates, fetchMock } = fakeServer([LEG_DAY]);
    await openTemplatesTab();
    await templateRow('Leg day');
    // Made on another phone since the list loaded.
    templates.push(PUSH_DAY);

    // A pull-to-refresh gesture ends by calling the list's onRefresh, so fire that directly.
    await fireEvent(screen.getByTestId('template-list'), 'refresh');

    expect(await templateRow('Push day')).toBeOnTheScreen();
    expect(requestsMade(fetchMock).filter((r) => r === 'GET /templates')).toHaveLength(2);
  });
});

it('creates a template, with a custom exercise, and opens it', async () => {
  const { bodies } = fakeServer();
  const app = await openTemplatesTab();

  await fireEvent.press(await screen.findByRole('button', { name: 'New template' }));
  await waitFor(() => expect(app.getPathname()).toBe('/templates/new'));
  // Nothing to save until there's a name and an exercise.
  expect(screen.getByRole('button', { name: 'Save template' })).toBeDisabled();

  await fireEvent.changeText(screen.getByLabelText('Template name'), ' Pull day ');
  await addExercise('RDL');
  await addExercise('Bench Press');
  // A custom exercise, created from the picker's search.
  await fireEvent.press(screen.getByRole('button', { name: 'Add exercise' }));
  await screen.findByRole('button', { name: 'Squat' });
  await fireEvent.changeText(screen.getByLabelText('Search exercises'), 'Barbell Row');
  await fireEvent.press(screen.getByRole('button', { name: 'Create "Barbell Row"' }));
  await fireEvent.press(await screen.findByRole('button', { name: 'Create' }));
  await screen.findByTestId('Barbell Row card');

  // New exercises start at 3 sets; the stepper changes that.
  await fireEvent.press(screen.getByRole('button', { name: 'More Barbell Row sets' }));
  await fireEvent.press(screen.getByRole('button', { name: 'More Barbell Row sets' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Fewer RDL sets' }));
  expect(within(screen.getByTestId('Barbell Row card')).getByText('5 sets')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Remove Bench Press' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Move Barbell Row up' }));
  expect(formOrder()).toEqual(['Barbell Row', 'RDL']);

  await fireEvent.press(screen.getByRole('button', { name: 'Save template' }));

  await waitFor(() => expect(app.getPathname()).toBe(`/templates/${NEW_ID}`));
  expect(bodies).toEqual([
    {
      name: 'Pull day',
      exercises: [
        { exercise_id: 104, set_count: 5 },
        { exercise_id: 2, set_count: 2 },
      ],
    },
  ]);
  expect(await detailLines()).toEqual(['Barbell Row · 5 sets', 'RDL · 2 sets']);

  // The form was replaced, so back goes to the list, which has the new template in name order.
  await act(() => router.back());
  expect(app.getPathname()).toBe('/templates');
  await templateRow('Pull day');
  expect(rowNames()).toEqual([
    'Leg day · Squat 3 · RDL 3 · Leg press 4',
    'Pull day · Barbell Row 5 · RDL 2',
    'Push day · Bench Press 5',
  ]);
});

it('edits a template: renames it and reorders its exercises', async () => {
  const { bodies } = fakeServer();
  const app = await openTemplatesTab();
  await openTemplate(app, 'Leg day', 1);
  expect(await detailLines()).toEqual(['Squat · 3 sets', 'RDL · 3 sets', 'Leg press · 4 sets']);

  await fireEvent.press(screen.getByRole('button', { name: 'Edit' }));
  await waitFor(() => expect(app.getPathname()).toBe('/templates/1/edit'));
  // The form starts from the saved template.
  expect(await screen.findByLabelText('Template name')).toHaveDisplayValue('Leg day');
  expect(formOrder()).toEqual(['Squat', 'RDL', 'Leg press']);
  // The ends can't move further.
  expect(screen.getByRole('button', { name: 'Move Squat up' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Move Leg press down' })).toBeDisabled();

  await fireEvent.changeText(screen.getByLabelText('Template name'), 'Lower body');
  await fireEvent.press(screen.getByRole('button', { name: 'Move Leg press up' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Move Leg press up' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Move Squat down' }));
  expect(formOrder()).toEqual(['Leg press', 'RDL', 'Squat']);
  await fireEvent.press(screen.getByRole('button', { name: 'Save template' }));

  // Back on the detail, which shows the saved template.
  await waitFor(() => expect(app.getPathname()).toBe('/templates/1'));
  expect(bodies).toEqual([
    {
      name: 'Lower body',
      exercises: [
        { exercise_id: 3, set_count: 4 },
        { exercise_id: 2, set_count: 3 },
        { exercise_id: 1, set_count: 3 },
      ],
    },
  ]);
  // waitFor: the detail was covered by the form, and re-renders from the cache as it comes back.
  await waitFor(() =>
    expect(currentDetailLines()).toEqual(['Leg press · 4 sets', 'RDL · 3 sets', 'Squat · 3 sets'])
  );

  await act(() => router.back());
  await templateRow('Lower body');
  expect(rowNames()).toEqual(['Lower body · Leg press 4 · RDL 3 · Squat 3', 'Push day · Bench Press 5']);
});

it('deletes a template after confirming, and goes back to the list', async () => {
  const { fetchMock } = fakeServer();
  const dialogs = recordAlerts();
  const app = await openTemplatesTab();
  await openTemplate(app, 'Leg day', 1);

  // Cancel: nothing is deleted.
  await fireEvent.press(await screen.findByRole('button', { name: 'Delete template' }));
  expect(dialogs.spy).toHaveBeenCalledWith(
    'Delete Leg day?',
    expect.any(String),
    expect.any(Array),
    expect.anything()
  );
  await dialogs.answer('Cancel');
  expect(requestsMade(fetchMock)).not.toContain('DELETE /templates/1');

  await fireEvent.press(screen.getByRole('button', { name: 'Delete template' }));
  await dialogs.answer('Delete');

  await waitFor(() => expect(app.getPathname()).toBe('/templates'));
  await templateRow('Push day');
  expect(rowNames()).toEqual(['Push day · Bench Press 5']);
  expect(requestsMade(fetchMock).filter((r) => r === 'DELETE /templates/1')).toHaveLength(1);
});

it("shows the server's error for a name already in use, until the name changes", async () => {
  const { bodies } = fakeServer();
  const app = await openTemplatesTab();
  await fireEvent.press(await screen.findByRole('button', { name: 'New template' }));
  await fireEvent.changeText(await screen.findByLabelText('Template name'), 'leg DAY');
  await addExercise('Squat');

  await fireEvent.press(screen.getByRole('button', { name: 'Save template' }));

  // The form stays, with the message from the 409.
  expect(await screen.findByRole('alert')).toHaveTextContent('A template named "leg DAY" already exists');
  expect(app.getPathname()).toBe('/templates/new');
  expect(bodies).toHaveLength(1);

  await fireEvent.changeText(screen.getByLabelText('Template name'), 'Leg day 2');
  expect(screen.queryByRole('alert')).not.toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Save template' }));
  await waitFor(() => expect(app.getPathname()).toBe(`/templates/${NEW_ID}`));
});

describe('leaving the form', () => {
  it('leaves without asking when nothing was changed', async () => {
    fakeServer();
    const dialogs = recordAlerts();
    const app = await openTemplatesTab();
    await fireEvent.press(await screen.findByRole('button', { name: 'New template' }));
    await waitFor(() => expect(app.getPathname()).toBe('/templates/new'));

    await act(() => router.back());

    expect(app.getPathname()).toBe('/templates');
    expect(dialogs.spy).not.toHaveBeenCalled();
  });

  it('asks "Discard changes?" when leaving an edit with unsaved changes', async () => {
    const { bodies } = fakeServer();
    const dialogs = recordAlerts();
    const app = await openTemplatesTab();
    await openTemplate(app, 'Leg day', 1);
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'More Squat sets' }));

    // Keep editing: the form stays, with the change.
    await act(() => router.back());
    expect(dialogs.spy).toHaveBeenCalledWith(
      'Discard changes?',
      expect.any(String),
      expect.any(Array),
      expect.anything()
    );
    await dialogs.answer('Keep editing');
    expect(app.getPathname()).toBe('/templates/1/edit');
    expect(within(screen.getByTestId('Squat card')).getByText('4 sets')).toBeOnTheScreen();

    // Discard: back to the detail, unchanged.
    await act(() => router.back());
    await dialogs.answer('Discard');
    await waitFor(() => expect(app.getPathname()).toBe('/templates/1'));
    expect(await detailLines()).toEqual(['Squat · 3 sets', 'RDL · 3 sets', 'Leg press · 4 sets']);
    expect(bodies).toEqual([]);
  });

  it('leaves without asking when the changes cancel out', async () => {
    fakeServer();
    const dialogs = recordAlerts();
    const app = await openTemplatesTab();
    await openTemplate(app, 'Leg day', 1);
    await fireEvent.press(await screen.findByRole('button', { name: 'Edit' }));
    await fireEvent.press(await screen.findByRole('button', { name: 'Move RDL up' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Move RDL down' }));

    await act(() => router.back());

    expect(app.getPathname()).toBe('/templates/1');
    expect(dialogs.spy).not.toHaveBeenCalled();
  });
});

it('shows a placeholder for "Start workout" until it is built', async () => {
  fakeServer();
  const dialogs = recordAlerts();
  const app = await openTemplatesTab();
  await openTemplate(app, 'Leg day', 1);

  await fireEvent.press(await screen.findByRole('button', { name: 'Start workout' }));

  expect(dialogs.spy).toHaveBeenCalledWith(
    'Coming soon',
    expect.any(String),
    expect.any(Array),
    expect.anything()
  );
  expect(app.getPathname()).toBe('/templates/1');
});

it('shows "Template not found" for a template that was deleted elsewhere', async () => {
  const { templates } = fakeServer();
  const app = await openTemplatesTab();
  await templateRow('Push day');
  templates.splice(1, 1);

  await fireEvent.press(await templateRow('Push day'));

  expect(await screen.findByText('Template not found')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Back to templates' }));
  await waitFor(() => expect(app.getPathname()).toBe('/templates'));
});

// Each button that navigates or sends a request, tapped twice: one screen or one request.
describe('double-tapping', () => {
  it('Save creates the template once', async () => {
    const { bodies, holdWrites } = fakeServer();
    const app = await openTemplatesTab();
    await fireEvent.press(await screen.findByRole('button', { name: 'New template' }));
    await fireEvent.changeText(await screen.findByLabelText('Template name'), 'Arms');
    await addExercise('Bench Press');
    const release = holdWrites();

    await doubleTap(screen.getByRole('button', { name: 'Save template' }));
    release();

    await waitFor(() => expect(app.getPathname()).toBe(`/templates/${NEW_ID}`));
    expect(bodies).toHaveLength(1);
  });

  it('a row opens its template once', async () => {
    fakeServer();
    const app = await openTemplatesTab();

    await doubleTap(await templateRow('Leg day'));
    await waitFor(() => expect(app.getPathname()).toBe('/templates/1'));
    await act(() => router.back());

    expect(app.getPathname()).toBe('/templates');
  });

  it('Delete asks once', async () => {
    fakeServer();
    const dialogs = recordAlerts();
    const app = await openTemplatesTab();
    await openTemplate(app, 'Leg day', 1);

    await doubleTap(await screen.findByRole('button', { name: 'Delete template' }));

    expect(dialogs.spy).toHaveBeenCalledTimes(1);
  });
});
