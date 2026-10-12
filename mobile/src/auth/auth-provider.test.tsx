import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, renderHook, waitFor } from '@testing-library/react-native';
import { SplashScreen } from 'expo-router';
import * as SecureStore from 'expo-secure-store';
import type { PropsWithChildren } from 'react';

import { ApiError } from '@/api/client';
import { isNoContent } from '@/api/types';
import { jsonResponse, mockApi, requestsMade } from '@/test-utils/mock-api';

import { AuthProvider, useApi, useAuth } from './auth-provider';
import { SplashScreenController } from './splash-screen-controller';
import { TOKEN_KEY } from './token-storage';

// jest.mock calls are hoisted to the top of the file, so these replace the real modules before
// any import above runs. The API URL normally comes from Expo's config; tests use a fixed one.
jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
// Uses the in-memory store in __mocks__/expo-secure-store.ts.
jest.mock('expo-secure-store');
// Keep the rest of expo-router real, but swap SplashScreen for spies.
jest.mock('expo-router', () => ({
  ...jest.requireActual<object>('expo-router'),
  SplashScreen: { preventAutoHideAsync: jest.fn(), hide: jest.fn() },
}));

const EMAIL = 'a@example.com';
const PASSWORD = 'hunter22';

beforeEach(async () => {
  await SecureStore.deleteItemAsync(TOKEN_KEY);
  jest.clearAllMocks(); // forget calls from the line above and from earlier tests
});

afterEach(() => {
  jest.restoreAllMocks(); // puts the real fetch back
});

// Renders useAuth() and useApi() inside the same providers as the app's root layout.
// A fresh QueryClient per test, so no cached data leaks between tests.
async function setup() {
  const queryClient = new QueryClient();
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>
        <AuthProvider>{children}</AuthProvider>
      </QueryClientProvider>
    );
  }
  // renderHook returns { result }; result.current is the hook's latest return value.
  const { result } = await renderHook(() => ({ auth: useAuth(), api: useApi() }), {
    wrapper: Wrapper,
  });
  return { result, queryClient };
}

// Awaits a promise that should reject and returns the error (see client.test.ts).
async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the promise to reject');
    },
    (error: unknown) => error
  );
}

// Runs a state-changing call that should reject inside act(), and returns its error.
// The error is caught inside the act() callback: when that callback itself rejects, act()
// doesn't pass the original error on.
async function caughtInAct(run: () => Promise<unknown>): Promise<unknown> {
  let error: unknown;
  await act(async () => {
    error = await caught(run());
  });
  return error;
}

const loginOk = () => jsonResponse(200, { token: 'tok-new', email: EMAIL });

describe('restoring the session on launch', () => {
  it('is signedOut when no token is saved', async () => {
    const { result } = await setup();

    await waitFor(() => expect(result.current.auth.status).toBe('signedOut'));
  });

  it('is signedIn with a saved token, and sends it with requests', async () => {
    await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
    let authHeader: string | null = null;
    mockApi({
      'DELETE /workouts/1': ({ headers }) => {
        authHeader = headers.get('Authorization');
        return new Response(null, { status: 204 });
      },
    });
    const { result } = await setup();

    await waitFor(() => expect(result.current.auth.status).toBe('signedIn'));
    await result.current.api.request('/workouts/1', { method: 'DELETE', guard: isNoContent });

    expect(authHeader).toBe('Bearer tok-saved');
  });

  it('is signedOut if reading the saved token fails', async () => {
    // mockRejectedValueOnce: only the next call fails; later calls use the in-memory store.
    jest.mocked(SecureStore.getItemAsync).mockRejectedValueOnce(new Error('Keystore unavailable'));
    const { result } = await setup();

    await waitFor(() => expect(result.current.auth.status).toBe('signedOut'));
  });
});

describe('splash screen', () => {
  it('stays up while loading and hides once the token has been read', async () => {
    // A read that doesn't finish until the test says so, to look at the in-between state.
    let finishRead: (token: string | null) => void = () => {};
    jest.mocked(SecureStore.getItemAsync).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishRead = resolve;
        })
    );
    const queryClient = new QueryClient();
    await render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <SplashScreenController />
        </AuthProvider>
      </QueryClientProvider>
    );

    expect(SplashScreen.hide).not.toHaveBeenCalled();

    // act() runs the update and lets React finish re-rendering before the assertion.
    await act(async () => finishRead(null));

    expect(SplashScreen.hide).toHaveBeenCalledTimes(1);
  });
});

describe('login', () => {
  it('sends the credentials, saves the token and signs in', async () => {
    let sentBody: unknown;
    mockApi({
      'POST /auth/login': ({ body }) => {
        sentBody = body;
        return loginOk();
      },
    });
    const { result } = await setup();
    await waitFor(() => expect(result.current.auth.status).toBe('signedOut'));

    await act(() => result.current.auth.login(EMAIL, PASSWORD));

    expect(sentBody).toEqual({ email: EMAIL, password: PASSWORD });
    expect(result.current.auth.status).toBe('signedIn');
    expect(await SecureStore.getItemAsync(TOKEN_KEY)).toBe('tok-new');
  });

  it('rejects with the server error on a wrong password and stays signed out', async () => {
    mockApi({
      'POST /auth/login': () => jsonResponse(401, { error: 'Invalid email or password' }),
    });
    const { result } = await setup();
    await waitFor(() => expect(result.current.auth.status).toBe('signedOut'));

    const error = await caughtInAct(() => result.current.auth.login(EMAIL, 'wrong'));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: 'Invalid email or password' });
    expect(result.current.auth.status).toBe('signedOut');
    expect(await SecureStore.getItemAsync(TOKEN_KEY)).toBeNull();
  });
});

describe('signup', () => {
  it('creates the account, then logs in with the same credentials', async () => {
    const fetchMock = mockApi({
      'POST /auth/signup': () => jsonResponse(201, { id: 7, email: EMAIL }),
      'POST /auth/login': loginOk,
    });
    const { result } = await setup();
    await waitFor(() => expect(result.current.auth.status).toBe('signedOut'));

    await act(() => result.current.auth.signup(EMAIL, PASSWORD));

    expect(requestsMade(fetchMock)).toEqual(['POST /auth/signup', 'POST /auth/login']);
    expect(result.current.auth.status).toBe('signedIn');
    expect(await SecureStore.getItemAsync(TOKEN_KEY)).toBe('tok-new');
  });

  it('rejects with the server error when the email is taken, without logging in', async () => {
    const fetchMock = mockApi({
      'POST /auth/signup': () => jsonResponse(409, { error: 'Email already in use' }),
      'POST /auth/login': loginOk,
    });
    const { result } = await setup();
    await waitFor(() => expect(result.current.auth.status).toBe('signedOut'));

    const error = await caughtInAct(() => result.current.auth.signup(EMAIL, PASSWORD));

    expect(error).toMatchObject({ status: 409, message: 'Email already in use' });
    expect(requestsMade(fetchMock)).toEqual(['POST /auth/signup']);
    expect(result.current.auth.status).toBe('signedOut');
  });
});

describe('logout', () => {
  it('deletes the saved token, clears cached queries and signs out', async () => {
    await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
    const { result, queryClient } = await setup();
    await waitFor(() => expect(result.current.auth.status).toBe('signedIn'));
    queryClient.setQueryData(['workouts'], ['cached for this user']);

    await act(() => result.current.auth.logout());

    expect(result.current.auth.status).toBe('signedOut');
    expect(await SecureStore.getItemAsync(TOKEN_KEY)).toBeNull();
    expect(queryClient.getQueryData(['workouts'])).toBeUndefined();
  });

  it('stops sending the old token', async () => {
    await SecureStore.setItemAsync(TOKEN_KEY, 'tok-saved');
    let authHeader: string | null = 'not called';
    mockApi({
      'DELETE /workouts/1': ({ headers }) => {
        authHeader = headers.get('Authorization');
        return new Response(null, { status: 204 });
      },
    });
    const { result } = await setup();
    await waitFor(() => expect(result.current.auth.status).toBe('signedIn'));

    await act(() => result.current.auth.logout());
    await result.current.api.request('/workouts/1', { method: 'DELETE', guard: isNoContent });

    expect(authHeader).toBeNull();
  });
});

describe('an expired token', () => {
  it('logs out when any request gets a 401', async () => {
    await SecureStore.setItemAsync(TOKEN_KEY, 'tok-expired');
    mockApi({
      'DELETE /workouts/1': () => jsonResponse(401, { error: 'Invalid or expired token' }),
    });
    const { result } = await setup();
    await waitFor(() => expect(result.current.auth.status).toBe('signedIn'));

    // The request still rejects (the caller sees the error); the logout happens alongside it.
    const error = await caughtInAct(() =>
      result.current.api.request('/workouts/1', { method: 'DELETE', guard: isNoContent })
    );

    expect(error).toMatchObject({ status: 401 });

    await waitFor(() => expect(result.current.auth.status).toBe('signedOut'));
    expect(await SecureStore.getItemAsync(TOKEN_KEY)).toBeNull();
  });
});
