import { ApiError, createApiClient, InvalidResponseError, NetworkError } from './client';
import { isLoginResponse, isNoContent, isWorkoutDetail } from './types';

const BASE_URL = 'http://192.168.1.5:3000';

const workout = { id: 3, date: '2026-10-11', notes: null, sets: [] };

// Builds a real fetch Response, so the client reads it exactly as it would a server's.
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// jest.spyOn replaces globalThis.fetch with a mock we control and can inspect.
// restoreAllMocks (in afterEach) puts the real fetch back, so tests can't affect each other.
let fetchMock: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  fetchMock = jest.spyOn(globalThis, 'fetch');
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

// A fresh client per test. jest.fn() records its calls, so tests can assert it was (or wasn't) called.
function setup(token: string | null = 'tok123') {
  const onUnauthorized = jest.fn();
  const client = createApiClient({ baseUrl: BASE_URL, getToken: () => token, onUnauthorized });
  return { client, onUnauthorized };
}

// The URL and options the client passed to fetch on its first call.
function firstFetchCall(): [string, RequestInit] {
  const call = fetchMock.mock.calls[0];
  if (!call) {
    throw new Error('fetch was not called');
  }
  const [url, init] = call;
  if (typeof url !== 'string' || init === undefined) {
    throw new Error('expected fetch(url: string, init)');
  }
  return [url, init];
}

// Awaits a request that should fail and returns what it threw. Jest's toEqual compares only the
// message of two Errors, so tests check the class and fields of the returned value instead.
async function caught(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => {
      throw new Error('expected the request to fail');
    },
    (error: unknown) => error
  );
}

describe('request', () => {
  it('GETs the full URL with the Bearer token and returns the validated body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, workout));
    const { client } = setup();

    // The guard decides the return type: here TypeScript infers WorkoutDetail.
    const result = await client.request('/workouts/3', { guard: isWorkoutDetail });

    expect(result).toEqual(workout);
    const [url, init] = firstFetchCall();
    expect(url).toBe(`${BASE_URL}/workouts/3`);
    expect(init.method).toBe('GET');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok123');
  });

  it('sends no Authorization header without a token', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, workout));
    const { client } = setup(null);

    await client.request('/workouts/3', { guard: isWorkoutDetail });

    const [, init] = firstFetchCall();
    expect(new Headers(init.headers).has('Authorization')).toBe(false);
  });

  it('sends a body as JSON', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, workout));
    const { client } = setup();

    await client.request('/workouts/3', {
      method: 'PATCH',
      body: { notes: 'Felt good' },
      guard: isWorkoutDetail,
    });

    const [, init] = firstFetchCall();
    expect(init.method).toBe('PATCH');
    expect(init.body).toBe(JSON.stringify({ notes: 'Felt good' }));
    expect(new Headers(init.headers).get('Content-Type')).toBe('application/json');
  });

  it('returns undefined for a 204 with no body', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    const { client } = setup();

    const result = await client.request('/workouts/3', { method: 'DELETE', guard: isNoContent });

    expect(result).toBeUndefined();
  });

  it('throws ApiError with the status and the server message for an { error } response', async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: 'Workout not found' }));
    const { client } = setup();

    const error = await caught(client.request('/workouts/99', { guard: isWorkoutDetail }));

    expect(error).toBeInstanceOf(ApiError);
    // toMatchObject checks only the listed properties.
    expect(error).toMatchObject({ status: 404, message: 'Workout not found' });
  });

  it('throws ApiError with a generic message when an error body is not JSON', async () => {
    // Express's default 404 for an unknown route is HTML, not { error }.
    fetchMock.mockResolvedValue(new Response('<pre>Cannot GET /nope</pre>', { status: 404 }));
    const { client } = setup();

    const error = await caught(client.request('/nope', { guard: isNoContent }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 404, message: 'Request failed with status 404' });
  });

  it('throws InvalidResponseError when a success body fails the guard', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { id: 'three' }));
    const { client } = setup();

    await expect(
      client.request('/workouts/3', { guard: isWorkoutDetail })
    ).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('throws InvalidResponseError when a success body is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('WorkoutApp API is alive', { status: 200 }));
    const { client } = setup();

    await expect(
      client.request('/workouts/3', { guard: isWorkoutDetail })
    ).rejects.toBeInstanceOf(InvalidResponseError);
  });

  it('throws NetworkError when the server cannot be reached', async () => {
    // React Native's fetch rejects with this TypeError when there's no connection.
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));
    const { client } = setup();

    await expect(
      client.request('/workouts', { guard: isWorkoutDetail })
    ).rejects.toBeInstanceOf(NetworkError);
  });

  it('throws NetworkError when the server takes longer than the timeout', async () => {
    // Fake timers: setTimeout no longer waits for real time; the test moves the clock itself.
    jest.useFakeTimers();
    // A fetch that never settles on its own, only when its AbortSignal fires (as real fetch does).
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('Aborted')));
        })
    );
    const { client } = setup();

    const pending = client.request('/workouts', { guard: isWorkoutDetail });
    jest.advanceTimersByTime(10_000);

    await expect(pending).rejects.toBeInstanceOf(NetworkError);
  });

  it('calls onUnauthorized on a 401 and still throws', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Invalid or expired token' }));
    const { client, onUnauthorized } = setup();

    const error = await caught(client.request('/workouts', { guard: isWorkoutDetail }));

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: 'Invalid or expired token' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does not call onUnauthorized for a 401 from /auth/login (wrong password)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(401, { error: 'Invalid email or password' }));
    const { client, onUnauthorized } = setup(null);

    const error = await caught(
      client.request('/auth/login', {
        method: 'POST',
        body: { email: 'a@example.com', password: 'wrong' },
        guard: isLoginResponse,
      })
    );

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, message: 'Invalid email or password' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });

  it('does not call onUnauthorized for other errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'Forbidden' }));
    const { client, onUnauthorized } = setup();

    await expect(client.request('/workouts', { guard: isWorkoutDetail })).rejects.toBeInstanceOf(
      ApiError
    );
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});
