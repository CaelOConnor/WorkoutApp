import { ApiError, InvalidResponseError, NetworkError } from './client';
import { errorMessage } from './error-message';

describe('errorMessage', () => {
  it.each([
    // The server's own { error } text is written for people, so 4xx messages pass through.
    ['a wrong password', new ApiError(401, 'Invalid email or password'), 'Invalid email or password'],
    ['an email in use', new ApiError(409, 'Email already in use'), 'Email already in use'],
  ])('shows the server message for %s', (_label, error, expected) => {
    expect(errorMessage(error)).toBe(expected);
  });

  it('does not show a 5xx message, which is about the server, not the user', () => {
    expect(errorMessage(new ApiError(500, 'Internal server error'))).toBe(
      'Something went wrong on the server. Please try again.'
    );
  });

  it('explains a network error, including the usual causes in development', () => {
    expect(errorMessage(new NetworkError('Could not reach the server'))).toMatch(
      /^Could not reach the server\. Check that .*backend is running/
    );
  });

  it('keeps the timeout wording of a network error', () => {
    expect(errorMessage(new NetworkError('The server took too long to respond'))).toMatch(
      /^The server took too long to respond\./
    );
  });

  it('has a message for a response the app cannot read', () => {
    expect(errorMessage(new InvalidResponseError(200))).toBe(
      'Unexpected response from server. The app may need an update.'
    );
  });

  it.each([
    ['an unknown Error', new Error('boom')],
    ['a thrown string', 'boom'],
  ])('falls back to a generic message for %s', (_label, error) => {
    expect(errorMessage(error)).toBe('Something went wrong. Please try again.');
  });
});
