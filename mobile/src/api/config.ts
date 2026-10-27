import Constants from 'expo-constants';

// The backend's default port. If it runs on another one (PORT), set EXPO_PUBLIC_API_URL instead.
const API_PORT = 3000;

export interface ApiUrlSources {
  envUrl: string | undefined; // EXPO_PUBLIC_API_URL
  hostUri: string | undefined; // the address the phone loaded the app from in dev, like '192.168.1.5:8081'
  isDev: boolean;
}

// Where the server is:
// 1. EXPO_PUBLIC_API_URL, if set (for an emulator, a tunnel, or a hosted server).
// 2. In dev, the same computer that serves the app, on the backend's port.
// Takes its inputs as parameters so tests don't need to fake Expo.
export function resolveApiUrl({ envUrl, hostUri, isDev }: ApiUrlSources): string {
  const trimmed = envUrl?.trim();
  if (trimmed) {
    return trimmed.replace(/\/+$/, ''); // drop trailing slashes
  }

  if (isDev && hostUri) {
    // The IP part, before the port.
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
    // Expo only fills this in when written exactly like this, not destructured.
    envUrl: process.env.EXPO_PUBLIC_API_URL,
    hostUri: Constants.expoConfig?.hostUri,
    isDev: __DEV__, // true in development builds
  });
}