// Integration tests for the progress screens (/progress and /progress/[exerciseId]): the real app
// from src/app/, signed in, with a fake backend. The chart itself (Skia) can't render in Jest, so
// jest.setup.ts swaps it for a placeholder; these tests check the list of points shown under it.
import type { ExerciseProgress, LoggedExercise, WorkoutDetail } from '@shared/models';
import { router, type Href } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';
import { Alert, type AlertButton } from 'react-native';

import { TOKEN_KEY } from '@/auth/token-storage';
import { jsonResponse, mockApi, requestsMade, type MockRoutes } from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');

// "Today": Wednesday 14 October 2026, so the default 6-month range starts on 14 April.
const NOW = new Date(2026, 9, 14, 10);

// GET /exercises/logged: most recently logged first.
const LOGGED: LoggedExercise[] = [
  { id: 1, name: 'Squat', last_date: '2026-10-12', unit: 'lb' },
  { id: 3, name: 'Pull-up', last_date: '2026-10-05', unit: 'lb' },
  { id: 2, name: 'Bench Press', last_date: '2025-09-30', unit: 'kg' },
];

const SQUAT_LB: ExerciseProgress = {
  exercise_id: 1,
  exercise_name: 'Squat',
  unit: 'lb',
  points: [
    { date: '2026-09-01', top_weight: 120, volume: 950, sets: 3 },
    { date: '2026-09-03', top_weight: 105, volume: 1325, sets: 2 },
  ],
};

const SQUAT_KG: ExerciseProgress = {
  ...SQUAT_LB,
  unit: 'kg',
  points: [
    { date: '2026-09-01', top_weight: 54.4, volume: 430.9, sets: 3 },
    { date: '2026-09-03', top_weight: 47.6, volume: 601, sets: 2 },
  ],
};

beforeEach(async () => {
  await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// A backend with an empty history plus `routes`. Returns the fetch mock, to check the requests.
function server(routes: MockRoutes) {
  return mockApi({ 'GET /workouts': () => jsonResponse(200, []), ...routes });
}

// Starts on the history, like a launch, then opens `url` the way a tap would (see
// workout-detail-screen.test.tsx for why tests can't start at a deep link).
async function renderApp(url: Href = '/') {
  const rendered = renderRouter('./src/app', { initialUrl: '/' });
  await rendered;
  await screen.findByRole('button', { name: 'Log out' });
  if (url !== '/') {
    await act(() => router.push(url));
  }
  return { getPathname: () => rendered.getPathname() };
}

// The accessible names of the rows under the chart, newest first.
async function pointRows() {
  const rows = await screen.findAllByLabelText(/^\w{3}, \w{3} \d+: /);
  return rows.map((row) => row.props.accessibilityLabel);
}

describe('the exercise list (/progress)', () => {
  it('opens from the Progress tab and lists logged exercises, most recent first', async () => {
    server({ 'GET /exercises/logged': () => jsonResponse(200, LOGGED) });
    const app = await renderApp();

    // The tab bar item's accessible name (see tabs.test.tsx).
    await fireEvent.press(screen.getByRole('button', { name: 'Progress, tab, 2 of 3' }));

    expect(app.getPathname()).toBe('/progress');
    const rows = await screen.findAllByRole('button', { name: /last logged/ });
    expect(rows.map((row) => row.props.accessibilityLabel)).toEqual([
      'Squat, last logged Oct 12',
      'Pull-up, last logged Oct 5',
      // Not this year, so the year shows.
      'Bench Press, last logged Sep 30, 2025',
    ]);
  });

  it('filters by name', async () => {
    server({ 'GET /exercises/logged': () => jsonResponse(200, LOGGED) });
    await renderApp('/progress');

    await fireEvent.changeText(await screen.findByLabelText('Search exercises'), 'pre');

    expect(screen.getAllByRole('button', { name: /last logged/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: /^Bench Press/ })).toBeOnTheScreen();
  });

  it('explains when nothing has been logged yet', async () => {
    server({ 'GET /exercises/logged': () => jsonResponse(200, []) });
    await renderApp('/progress');

    expect(await screen.findByText('No exercises logged yet')).toBeOnTheScreen();
  });
});

describe('the chart screen (/progress/[exerciseId])', () => {
  it('opens from the list, showing 6 months of heaviest sets', async () => {
    const fetchMock = server({
      'GET /exercises/logged': () => jsonResponse(200, LOGGED),
      'GET /exercises/1/progress?from=2026-04-14': () => jsonResponse(200, SQUAT_LB),
    });
    const app = await renderApp('/progress');

    await fireEvent.press(await screen.findByRole('button', { name: /^Squat/ }));

    expect(app.getPathname()).toBe('/progress/1');
    expect(await pointRows()).toEqual(['Thu, Sep 3: 105 lb, 2 sets', 'Tue, Sep 1: 120 lb, 3 sets']);
    expect(screen.getByRole('radio', { name: 'Heaviest set' })).toBeChecked();
    expect(screen.queryByRole('radio', { name: 'Est. 1RM' })).not.toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: '6M' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'lb' })).toBeChecked();
    // No unit sent: the server picks the one last logged.
    expect(requestsMade(fetchMock)).toContain('GET /exercises/1/progress?from=2026-04-14');
    expect(screen.getByTestId('progress-chart')).toBeOnTheScreen();
  });

  it('switches the metric without asking the server again', async () => {
    const fetchMock = server({
      'GET /exercises/1/progress?from=2026-04-14': () => jsonResponse(200, SQUAT_LB),
    });
    await renderApp('/progress/1');
    await pointRows();
    const requestCount = fetchMock.mock.calls.length;

    await fireEvent.press(screen.getByRole('radio', { name: 'Volume' }));
    expect(await pointRows()).toEqual(['Thu, Sep 3: 1,325 lb, 2 sets', 'Tue, Sep 1: 950 lb, 3 sets']);

    await fireEvent.press(screen.getByRole('radio', { name: 'Heaviest set' }));
    expect(await pointRows()).toEqual(['Thu, Sep 3: 105 lb, 2 sets', 'Tue, Sep 1: 120 lb, 3 sets']);

    expect(fetchMock.mock.calls).toHaveLength(requestCount);
  });

  it('asks for another date range', async () => {
    const fetchMock = server({
      'GET /exercises/1/progress?from=2026-04-14': () => jsonResponse(200, SQUAT_LB),
      'GET /exercises/1/progress': () => jsonResponse(200, SQUAT_LB),
      'GET /exercises/1/progress?from=2026-07-14': () => jsonResponse(200, { ...SQUAT_LB, points: [] }),
    });
    await renderApp('/progress/1');
    await pointRows();

    await fireEvent.press(screen.getByRole('radio', { name: 'All' }));
    await fireEvent.press(screen.getByRole('radio', { name: '3M' }));

    expect(await screen.findByText('No sets in this range')).toBeOnTheScreen();
    expect(requestsMade(fetchMock)).toEqual(
      expect.arrayContaining(['GET /exercises/1/progress', 'GET /exercises/1/progress?from=2026-07-14'])
    );
  });

  it('switches the unit', async () => {
    server({
      'GET /exercises/1/progress?from=2026-04-14': () => jsonResponse(200, SQUAT_LB),
      'GET /exercises/1/progress?unit=kg&from=2026-04-14': () => jsonResponse(200, SQUAT_KG),
    });
    await renderApp('/progress/1');
    await pointRows();

    await fireEvent.press(screen.getByRole('radio', { name: 'kg' }));

    expect(await screen.findByLabelText('Thu, Sep 3: 47.6 kg, 2 sets')).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'kg' })).toBeChecked();
  });

  it('explains when an exercise has no weighted sets', async () => {
    const pullUps: ExerciseProgress = {
      exercise_id: 3,
      exercise_name: 'Pull-up',
      unit: 'lb',
      points: [{ date: '2026-10-05', top_weight: 0, volume: 0, sets: 3 }],
    };
    server({ 'GET /exercises/3/progress?from=2026-04-14': () => jsonResponse(200, pullUps) });
    await renderApp('/progress/3');

    expect(await screen.findByText('No weighted sets yet')).toBeOnTheScreen();
    expect(screen.queryByTestId('progress-chart')).not.toBeOnTheScreen();
  });

  it('shows "Exercise not found" for a 404', async () => {
    server({
      'GET /exercises/99/progress?from=2026-04-14': () =>
        jsonResponse(404, { error: 'Exercise not found' }),
    });
    await renderApp('/progress/99');

    expect(await screen.findByText('Exercise not found')).toBeOnTheScreen();
  });

  it('shows "Exercise not found" for an id that cannot be one, without asking the server', async () => {
    const fetchMock = server({});
    await renderApp('/progress/abc');

    expect(await screen.findByText('Exercise not found')).toBeOnTheScreen();
    expect(requestsMade(fetchMock).filter((r) => r.includes('/progress'))).toEqual([]);
  });
});

it("opens from a workout's exercise card menu", async () => {
  const workout: WorkoutDetail = {
    id: 5,
    date: '2026-10-12',
    notes: null,
    sets: [{ id: 51, exercise_id: 1, exercise_name: 'Squat', set_number: 1, reps: 5, weight: 225, unit: 'lb' }],
  };
  server({
    'GET /workouts/5': () => jsonResponse(200, workout),
    'GET /exercises/1/progress?from=2026-04-14': () => jsonResponse(200, SQUAT_LB),
  });
  // Presses "View progress" in the card's menu.
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons?: AlertButton[]) => {
    buttons?.find((b) => b.text === 'View progress')?.onPress?.();
  });
  const app = await renderApp('/workouts/5');

  await fireEvent.press(await screen.findByRole('button', { name: 'Squat options' }));

  expect(await pointRows()).toHaveLength(2);
  expect(app.getPathname()).toBe('/progress/1');
});
