// The one place the app talks to the server. Every request goes through request<T>(), which
// adds the login token, sorts failures into three error types, and checks the response with a guard.
import { isErrorResponse } from './types';

// The server answered with an error status. message is the server's error text when there is one.
export class ApiError extends Error {
  override name = 'ApiError';

  // readonly status in the constructor declares the field and sets it in one step.
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

// No answer at all: no connection, wrong address, server down, or a timeout.
export class NetworkError extends Error {
  override name = 'NetworkError';
}

// The server said yes, but the data isn't the expected shape. A bug, not something the user can fix.
export class InvalidResponseError extends Error {
  override name = 'InvalidResponseError';

  constructor(readonly status: number) {
    super('Unexpected response from server');
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

// Any type guard: takes unknown, says whether it's a T.
export type Guard<T> = (value: unknown) => value is T;

export interface RequestOptions<T> {
  method?: HttpMethod; // defaults to GET
  body?: unknown; // sent as JSON
  // Required, so no response reaches the app unchecked. The guard also decides what request() returns.
  guard: Guard<T>;
}

export interface ApiClientConfig {
  baseUrl: string;
  getToken: () => string | null;
  onUnauthorized: () => void; // the token was rejected, so log out
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

// A 401 from login means a wrong password, not an expired token, so it shouldn't log out.
const LOGIN_PATH = '/auth/login';

// Either the parsed body, or "not valid JSON". A flag is used because null and false are valid JSON.
type ParsedBody = { ok: true; value: unknown } | { ok: false };

// An empty body (a 204) counts as undefined.
function parseBody(text: string): ParsedBody {
  if (text === '') {
    return { ok: true, value: undefined };
  }
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export function createApiClient(config: ApiClientConfig) {
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // path must start with '/', so a missing slash is a compile error.
  async function request<T>(path: `/${string}`, options: RequestOptions<T>): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    const token = config.getToken();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }

    // fetch never times out on its own, so cancel it after timeoutMs.
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
      // Reading the body can fail too, so it's inside the try.
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
      const message =
        parsed.ok && isErrorResponse(parsed.value)
          ? parsed.value.error
          : `Request failed with status ${response.status}`;
      throw new ApiError(response.status, message);
    }

    if (!parsed.ok || !options.guard(parsed.value)) {
      throw new InvalidResponseError(response.status);
    }
    return parsed.value; // the guard passed, so this is a T
  }

  return { request };
}

// The client's type, taken from what createApiClient returns.
export type ApiClient = ReturnType<typeof createApiClient>;