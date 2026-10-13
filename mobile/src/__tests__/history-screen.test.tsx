// Integration tests for the workout history (home) screen: the real app from src/app/, signed in,
// with a fake backend.
import type { WorkoutDetail } from '@shared/models';
import { act, fireEvent, renderRouter, screen, waitFor, within } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { TOKEN_KEY } from '@/auth/token-storage';
import { jsonResponse, mockApi, requestsMade } from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');

// "Today" for every test: Wednesday 14 October 2026, 10am local time. This week is Mon 12 – Sun 18.
const NOW = new Date(2026, 9, 14, 10);

// The same shape GET /workouts returns, newest first.
const WORKOUTS: WorkoutDetail[] = [
  {
    id: 3,
    date: '2026-10-14',
    notes: null,
    sets: [
      { id: 31, exercise_id: 1, set_number: 1, reps: 5, weight: '225.00', unit: 'lb', exercise_name: 'Squat' },
      { id: 32, exercise_id: 1, set_number: 2, reps: 5, weight: '225.00', unit: 'lb', exercise_name: 'Squat' },
      { id: 33, exercise_id: 2, set_number: 3, reps: 8, weight: '135.00', unit: 'lb', exercise_name: 'Bench Press' },
    ],
  },
  {
    id: 2,
    date: '2026-10-11', // a Sunday: last week, not this week
    notes: null,
    sets: [
      { id: 21, exercise_id: 3, set_number: 1, reps: 3, weight: '315.00', unit: 'lb', exercise_name: 'Deadlift' },
    ],
  },
  { id: 1, date: '2026-09-30', notes: null, sets: [] },
];

beforeEach(async () => {
  await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
  // renderRouter switches to fake timers but keeps the current time, so setting it here sticks.
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// See auth-screens.test.tsx for why the Promise is awaited separately.
async function renderApp(initialUrl = '/') {
  const rendered = renderRouter('./src/app', { initialUrl });
  await rendered;
  return { getPathname: () => rendered.getPathname() };
}

it('shows workouts grouped by week, newest first', async () => {
  mockApi({ 'GET /workouts': () => jsonResponse(200, WORKOUTS) });
  await renderApp();

  expect(await screen.findByText('This week')).toBeOnTheScreen();
  // Section headers have the header role, so they can be checked in order.
  expect(screen.getAllByRole('header').map((h) => h.props.children)).toEqual([
    'This week',
    'Last week',
    'Sep 28 – Oct 4',
  ]);

  // One row per workout. Its accessible name is everything it shows, for screen readers.
  const row = screen.getByRole('button', { name: /Wed, Oct 14/ });
  expect(within(row).getByText('Squat, Bench Press')).toBeOnTheScreen();
  expect(within(row).getByText('3 sets')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /Sun, Oct 11.*Deadlift.*1 set/ })).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: /Wed, Sep 30.*No exercises.*0 sets/ })).toBeOnTheScreen();
});

it('shows an empty state when there are no workouts', async () => {
  mockApi({ 'GET /workouts': () => jsonResponse(200, []) });
  await renderApp();

  expect(await screen.findByText('No workouts yet')).toBeOnTheScreen();
});

it('shows an error with a retry button that loads the workouts again', async () => {
  let serverUp = false;
  const fetchMock = mockApi({
    'GET /workouts': () =>
      serverUp ? jsonResponse(200, WORKOUTS) : jsonResponse(500, { error: 'Internal server error' }),
  });
  await renderApp();

  // A 5xx is retried twice (query-client.ts), 1 s then 2 s apart, before the error shows.
  await act(() => jest.advanceTimersByTimeAsync(5_000));
  expect(await screen.findByText(/Something went wrong on the server/)).toBeOnTheScreen();
  expect(requestsMade(fetchMock)).toEqual(['GET /workouts', 'GET /workouts', 'GET /workouts']);

  serverUp = true;
  await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));

  expect(await screen.findByText('This week')).toBeOnTheScreen();
  expect(screen.queryByText(/Something went wrong/)).not.toBeOnTheScreen();
});

it('refetches when the list is pulled down', async () => {
  const fetchMock = mockApi({ 'GET /workouts': () => jsonResponse(200, []) });
  await renderApp();
  await screen.findByText('No workouts yet');

  // A pull-to-refresh gesture ends by calling the list's onRefresh, so fire that directly.
  await fireEvent(screen.getByTestId('workout-history'), 'refresh');

  await waitFor(() => expect(requestsMade(fetchMock)).toEqual(['GET /workouts', 'GET /workouts']));
});

it('opens a workout when its row is pressed', async () => {
  mockApi({ 'GET /workouts': () => jsonResponse(200, WORKOUTS) });
  const app = await renderApp();

  await fireEvent.press(await screen.findByRole('button', { name: /Sun, Oct 11/ }));

  await waitFor(() => expect(app.getPathname()).toBe('/workouts/2'));
});

it('opens the log workout screen from the header', async () => {
  mockApi({ 'GET /workouts': () => jsonResponse(200, []) });
  const app = await renderApp();

  await fireEvent.press(await screen.findByRole('button', { name: 'Log workout' }));

  await waitFor(() => expect(app.getPathname()).toBe('/workouts/new'));
});
