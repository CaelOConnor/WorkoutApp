// Integration tests for the tab bar (src/app/(tabs)/_layout.tsx): the real app from src/app/,
// signed in, with a fake backend. Each tab's own screen has its own test file; these only check
// switching between them, and that other screens still open over the tabs.
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { TOKEN_KEY } from '@/auth/token-storage';
import { jsonResponse, mockApi } from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');

beforeEach(async () => {
  await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
  mockApi({
    'GET /workouts': () => jsonResponse(200, []),
    'GET /exercises/logged': () => jsonResponse(200, []),
    'GET /templates': () => jsonResponse(200, []),
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  // renderRouter switches to fake timers; switch back so other tests aren't affected.
  jest.useRealTimers();
});

async function renderApp() {
  const rendered = renderRouter('./src/app', { initialUrl: '/' });
  await rendered;
  await screen.findByRole('button', { name: 'Log out' });
  return { getPathname: () => rendered.getPathname() };
}

// The tab bar's item for a tab. Bottom tabs render each item as a button labelled
// "<label>, tab, <n> of <count>" (what a screen reader reads out) inside a "tablist".
function tab(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^${name}, tab, \\d+ of \\d+$`) });
}

it('starts on History, with a tab for each area', async () => {
  const app = await renderApp();

  expect(app.getPathname()).toBe('/');
  expect(tab('History')).toBeOnTheScreen();
  expect(tab('Progress')).toBeOnTheScreen();
  expect(tab('Templates')).toBeOnTheScreen();
  // The history's header keeps "+ Log workout"; Progress moved from the header to the tab bar.
  expect(screen.getByRole('button', { name: 'Log workout' })).toBeOnTheScreen();
  expect(screen.queryByRole('button', { name: 'Progress' })).not.toBeOnTheScreen();
});

it('switches between the tabs', async () => {
  const app = await renderApp();

  await fireEvent.press(tab('Progress'));
  expect(app.getPathname()).toBe('/progress');
  expect(await screen.findByText('No exercises logged yet')).toBeOnTheScreen();

  await fireEvent.press(tab('Templates'));
  expect(app.getPathname()).toBe('/templates');
  expect(await screen.findByText('No templates yet')).toBeOnTheScreen();

  await fireEvent.press(tab('History'));
  expect(app.getPathname()).toBe('/');
  expect(await screen.findByText('No workouts yet')).toBeOnTheScreen();
});

it('opens other screens over the tabs, without the tab bar, and back returns to the tab', async () => {
  const app = await renderApp();
  await fireEvent.press(tab('Progress'));

  await act(() => router.push('/workouts/new'));

  expect(app.getPathname()).toBe('/workouts/new');
  // Screens covered by the new one are hidden from accessibility queries, tab bar included.
  expect(screen.queryAllByRole('tablist')).toEqual([]);

  await act(() => router.back());
  expect(app.getPathname()).toBe('/progress');
  expect(tab('Progress')).toBeOnTheScreen();
});
