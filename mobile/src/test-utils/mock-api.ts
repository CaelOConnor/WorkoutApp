// Test helpers that stand in for the backend by mocking global fetch.
//
// Tests describe the server as a table of routes ('POST /auth/login' -> response). Going through
// fetch, rather than mocking the API client, means the real client code (headers, error classes,
// 401 handling) runs in every test too.

// Must match the getApiUrl mock in each test file. (jest.mock factories are hoisted above the
// imports, so they can't use a constant imported from here.)
export const TEST_API_URL = 'http://api.test';

export function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// What a route handler receives: the parsed JSON body and the request headers.
export interface MockRequest {
  body: unknown;
  headers: Headers;
}

// A Record keyed by 'METHOD /path'. The handler can be async, e.g. to hold a request open.
export type MockRoutes = Record<string, (request: MockRequest) => Response | Promise<Response>>;

// Replaces fetch for the current test (restore with jest.restoreAllMocks()). A request with no
// matching route gets a 500 naming it, which surfaces as an ApiError instead of a silent hang.
export function mockApi(routes: MockRoutes): jest.SpiedFunction<typeof fetch> {
  return jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const path = String(input).replace(TEST_API_URL, '');
    const key = `${init?.method ?? 'GET'} ${path}`;
    const handler = routes[key];
    if (!handler) {
      return jsonResponse(500, { error: `No mock for ${key}` });
    }
    const body: unknown = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    return handler({ body, headers: new Headers(init?.headers) });
  });
}

// The 'METHOD /path' of every request made so far, in order.
export function requestsMade(fetchMock: jest.SpiedFunction<typeof fetch>): string[] {
  return fetchMock.mock.calls.map(
    ([input, init]) => `${init?.method ?? 'GET'} ${String(input).replace(TEST_API_URL, '')}`
  );
}
