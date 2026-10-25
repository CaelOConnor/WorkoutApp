// Integration tests: the real screens and root layout from src/app/, with a fake backend.
// (Tests can't live in src/app/: Expo Router treats every file there as a route.)
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import * as SecureStore from 'expo-secure-store';

import { TOKEN_KEY } from '@/auth/token-storage';
import { jsonResponse, mockApi, requestsMade } from '@/test-utils/mock-api';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');

const EMAIL = 'a@example.com';
const PASSWORD = 'hunter22';

beforeEach(async () => {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
});

afterEach(() => {
  jest.restoreAllMocks();
  // renderRouter switches to fake timers; switch back so other tests aren't affected.
  jest.useRealTimers();
});

// With RNTL 14, renderRouter returns a Promise with getPathname on it (toHavePathname can't see it).
// Returning that Promise from an async function would unwrap it and lose getPathname, hence the object.
async function renderApp(initialUrl = '/') {
  const rendered = renderRouter('./src/app', { initialUrl });
  await rendered;
  return { getPathname: () => rendered.getPathname() };
}

// Queries find elements the way a user or screen reader would: by label or role, not component names.
async function submitForm(buttonName: RegExp, email = EMAIL, password = PASSWORD) {
  await fireEvent.changeText(screen.getByLabelText('Email'), email);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
  await fireEvent.press(screen.getByRole('button', { name: buttonName }));
}

describe('when signed out', () => {
  it('opens on the login screen', async () => {
    const app = await renderApp();

    expect(await screen.findByRole('button', { name: /log in/i })).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/login');
  });

  it('shows the server error for a wrong password and stays on login', async () => {
    mockApi({
      'POST /auth/login': () => jsonResponse(401, { error: 'Invalid email or password' }),
    });
    const app = await renderApp();
    await screen.findByRole('button', { name: /log in/i });

    await submitForm(/log in/i, EMAIL, 'wrong');

    expect(await screen.findByText('Invalid email or password')).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/login');
  });

  it('shows a clear message when the server cannot be reached', async () => {
    // React Native's fetch rejects like this with no connection.
    jest.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Network request failed'));
    await renderApp();
    await screen.findByRole('button', { name: /log in/i });

    await submitForm(/log in/i);

    expect(await screen.findByText(/^Could not reach the server/)).toBeOnTheScreen();
  });

  it('disables the button while logging in', async () => {
    // A login that doesn't answer until the test says so.
    let respond: (response: Response) => void = () => {};
    mockApi({
      'POST /auth/login': () =>
        new Promise<Response>((resolve) => {
          respond = resolve;
        }),
    });
    await renderApp();
    await screen.findByRole('button', { name: /log in/i });

    await submitForm(/log in/i);

    // toBeDisabled checks accessibilityState / aria-disabled, which screen readers announce too.
    expect(screen.getByRole('button', { name: /log in/i })).toBeDisabled();
    await act(async () => respond(jsonResponse(200, { token: 'tok-new', email: EMAIL })));
  });

  it('reaches the home screen after a successful login', async () => {
    mockApi({
      'POST /auth/login': () => jsonResponse(200, { token: 'tok-new', email: EMAIL }),
      'GET /workouts': () => jsonResponse(200, []),
    });
    const app = await renderApp();
    await screen.findByRole('button', { name: /log in/i });

    await submitForm(/log in/i);

    expect(await screen.findByRole('button', { name: /log out/i })).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
  });

  it('can go to signup, where an email in use shows the server error', async () => {
    const fetchMock = mockApi({
      'POST /auth/signup': () => jsonResponse(409, { error: 'Email already in use' }),
    });
    const app = await renderApp();

    await fireEvent.press(await screen.findByRole('link', { name: /create an account/i }));
    await waitFor(() => expect(app.getPathname()).toBe('/signup'));
    await submitForm(/create account/i);

    expect(await screen.findByText('Email already in use')).toBeOnTheScreen();
    expect(requestsMade(fetchMock)).toEqual(['POST /auth/signup']);
  });

  it('signs up and lands on the home screen', async () => {
    mockApi({
      'POST /auth/signup': () => jsonResponse(201, { id: 7, email: EMAIL }),
      'POST /auth/login': () => jsonResponse(200, { token: 'tok-new', email: EMAIL }),
      'GET /workouts': () => jsonResponse(200, []),
    });
    const app = await renderApp();

    await fireEvent.press(await screen.findByRole('link', { name: /create an account/i }));
    await waitFor(() => expect(app.getPathname()).toBe('/signup'));
    await submitForm(/create account/i);

    expect(await screen.findByRole('button', { name: /log out/i })).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
  });
});

describe('when signed in', () => {
  beforeEach(async () => {
    await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
    // The home screen loads the workout history.
    mockApi({ 'GET /workouts': () => jsonResponse(200, []) });
  });

  it('opens on the home screen', async () => {
    const app = await renderApp();

    expect(await screen.findByRole('button', { name: /log out/i })).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
  });

  it('cannot open the login screen', async () => {
    // Stack.Protected redirects away from a screen whose guard is false.
    const app = await renderApp('/login');

    expect(await screen.findByRole('button', { name: /log out/i })).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/');
  });

  it('goes back to login after logging out', async () => {
    const app = await renderApp();

    await fireEvent.press(await screen.findByRole('button', { name: /log out/i }));

    expect(await screen.findByRole('button', { name: /log in/i })).toBeOnTheScreen();
    expect(app.getPathname()).toBe('/login');
    expect(await SecureStore.getItemAsync(TOKEN_KEY)).toBeNull();
  });
});
