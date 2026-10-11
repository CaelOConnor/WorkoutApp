import Constants from 'expo-constants';

// Must match the port in backend/src/index.ts.
const API_PORT = 3000;

export interface ApiUrlSources {
  envUrl: string | undefined; // EXPO_PUBLIC_API_URL
  hostUri: string | undefined; // where Metro is serving from in dev, e.g. '192.168.1.5:8081'
  isDev: boolean;
}

// Where the backend is, in order of preference:
// 1. EXPO_PUBLIC_API_URL (from mobile/.env.local, say), for an emulator, a tunnel, or production.
// 2. In dev, the computer running Metro: the phone already reaches it over Wi-Fi at hostUri's
//    IP, and the backend runs on the same computer, just on another port.
// A pure function of its inputs, so tests can call it without mocking Expo.
export function resolveApiUrl({ envUrl, hostUri, isDev }: ApiUrlSources): string {
  const trimmed = envUrl?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, '');
  }

  if (isDev && hostUri) {
    // The host part: everything before the first ':' (port) or '/' (path).
    // match() returns null when nothing matches, and with noUncheckedIndexedAccess the capture
    // group [1] is `string | undefined`, so both are handled before use.
    const host = hostUri.match(/^([^:/]+)/)?.[1];
    if (host) {
      return `http://${host}:${API_PORT}`;
    }
  }

  throw new Error(
    'No API URL: set EXPO_PUBLIC_API_URL in mobile/.env.local, or run a dev build from `npm start`.'
  );
}

export function getApiUrl(): string {
  return resolveApiUrl({
    // Expo inlines EXPO_PUBLIC_ variables at build time, but only when written exactly as
    // process.env.EXPO_PUBLIC_NAME: not destructured, not process.env[name].
    envUrl: process.env.EXPO_PUBLIC_API_URL,
    // expoConfig is null when no manifest is available, hence `?.`.
    hostUri: Constants.expoConfig?.hostUri,
    // __DEV__ is a React Native global: true in development builds, false in release builds.
    isDev: __DEV__,
  });
}
