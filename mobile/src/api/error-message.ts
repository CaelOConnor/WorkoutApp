import { ApiError, InvalidResponseError, NetworkError } from './client';

// Turns anything a request can throw into a sentence to show the user. `error` is `unknown`
// because JavaScript can throw any value, so it's narrowed with instanceof, most specific first.
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    // 4xx messages come from our own API and are written for the user ("Email already in use").
    // A 5xx message describes a server bug, so show something the user can act on instead.
    return error.status >= 500
      ? 'Something went wrong on the server. Please try again.'
      : error.message;
  }
  if (error instanceof NetworkError) {
    // In development this almost always means a wrong API URL, a stopped backend, a phone on
    // another network, or the Windows Firewall blocking port 3000.
    return `${error.message}. Check that the backend is running and that your phone is on the same Wi-Fi as your computer.`;
  }
  if (error instanceof InvalidResponseError) {
    return `${error.message}. The app may need an update.`;
  }
  return 'Something went wrong. Please try again.';
}
