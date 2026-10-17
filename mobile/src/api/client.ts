// The one place the app talks to the backend. Every request goes through request<T>(), which:
// - adds the Bearer token, if there is one
// - turns every failure into one of three error classes the screens can tell apart
// - checks the response body with a type guard, so callers get a real T, not `any`
import { isErrorResponse } from './types';

// Thrown when the API answered with an error status (4xx/5xx). `message` is the server's
// { error } text when there is one, so screens can show it directly.
export class ApiError extends Error {
  override name = 'ApiError';

  // `readonly status: number` in the constructor is a "parameter property": it declares the
  // field and assigns it in one go.
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// Thrown when no response arrived: no connection, wrong API URL, server down, or a timeout.
export class NetworkError extends Error {
  override name = 'NetworkError';
}

// Thrown when a success response doesn't have the shape we expected: the app and the server
// disagree about the API, which is a bug rather than something the user can fix.
export class InvalidResponseError extends Error {
  override name = 'InvalidResponseError';

  constructor(readonly status: number) {
    super('Unexpected response from server');
  }
}

// PUT replaces a whole resource (PUT /templates/:id); PATCH changes only the fields sent.
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// A function type for any type guard: given unknown, it says whether the value is a T.
export type Guard<T> = (value: unknown) => value is T;

export interface RequestOptions<T> {
  method?: HttpMethod; // defaults to GET
  body?: unknown; // sent as JSON
  // Required, so no response can reach the app unchecked. T is inferred from it:
  // passing isWorkoutDetail makes request() return Promise<WorkoutDetail>.
  guard: Guard<T>;
}

export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
  // Called when the server rejects the token (expired or invalid), e.g. to log out.
  onUnauthorized: () => void;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// A 401 here means a wrong email or password, not a bad token, so it mustn't trigger a logout.
const LOGIN_PATH = '/auth/login';

// The result of trying to parse a body. A "discriminated union": checking `ok` tells TypeScript
// which variant you have, and so whether `value` exists. JSON can legitimately be null or
// false, so a separate flag is clearer than returning a special value for "not JSON".
type ParsedBody = { ok: true; value: unknown } | { ok: false };

// An empty body (204) parses as undefined, which the isNoContent guard accepts.
function parseBody(text: string): ParsedBody {
  if (text === '') {
    return { ok: true, value: undefined };
  }
  try {
    // JSON.parse returns `any`; assigning it to `unknown` stops the `any` from spreading.
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export function createApiClient(config: ApiClientConfig) {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // `/${string}` is a template literal type: any string starting with '/'. So request('workouts')
  // (which would build '...:3000workouts') is a compile error.
  async function request<T>(path: `/${string}`, options: RequestOptions<T>): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = config.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    // fetch has no timeout of its own, and a wrong LAN IP can hang for a long time.
    // Aborting the controller makes fetch reject, which is caught below.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    let text: string;
    try {
      response = await fetch(`${config.baseUrl}${path}`, {
        method: options.method ?? 'GET',
        headers,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      // The body streams in after the headers, so the connection can still fail while reading it.
      text = await response.text();
    } catch {
      throw new NetworkError(
        controller.signal.aborted ? 'The server took too long to respond' : 'Could not reach the server'
      );
    } finally {
      clearTimeout(timer);
    }

    const parsed = parseBody(text);

    if (!response.ok) {
      if (response.status === 401 && path !== LOGIN_PATH) {
        config.onUnauthorized();
      }
      // `parsed.ok &&` narrows the union first, so reading parsed.value is allowed.
      const message =
        parsed.ok && isErrorResponse(parsed.value)
          ? parsed.value.error
          : `Request failed with status ${response.status}`;
      throw new ApiError(response.status, message);
    }

    if (!parsed.ok || !options.guard(parsed.value)) {
      throw new InvalidResponseError(response.status);
    }
    // The guard returned true, so TypeScript has narrowed parsed.value to T.
    return parsed.value;
  }

  return { request };
}

// The client's type, derived from the factory rather than written out twice.
// ReturnType<typeof f> is "whatever f returns".
export type ApiClient = ReturnType<typeof createApiClient>;
