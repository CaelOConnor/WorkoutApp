import { ApiError, InvalidResponseError, NetworkError } from './client';
import { shouldRetry } from './query-client';

describe('shouldRetry', () => {
  it.each([
    ['a network error', new NetworkError('Could not reach the server')],
    ['a 500', new ApiError(500, 'Internal server error')],
  ])('retries %s', (_label, error) => {
    expect(shouldRetry(0, error)).toBe(true);
  });

  it('gives up after two retries', () => {
    expect(shouldRetry(2, new NetworkError('Could not reach the server'))).toBe(false);
  });

  it.each([
    // The same request would get the same answer: retrying only delays showing the error.
    ['a 401', new ApiError(401, 'Invalid or expired token')],
    ['a 404', new ApiError(404, 'Workout not found')],
    ['a response the app cannot read', new InvalidResponseError(200)],
  ])('does not retry %s', (_label, error) => {
    expect(shouldRetry(0, error)).toBe(false);
  });
});
