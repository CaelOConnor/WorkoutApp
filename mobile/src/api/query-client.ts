// TanStack Query setup. Queries (useQuery) cache server data by key and refetch it when it may be
// stale; this file configures when that happens.
import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { ApiError, NetworkError } from './client';

const MAX_RETRIES = 2;

// Retry only failures that might go away on their own: no connection, or a server error (5xx).
// A 4xx or an unreadable response would just fail the same way again.
export function shouldRetry(failureCount: number, error: Error): boolean {
  const transient =
    error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
  return transient && failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
      // A failed mutation (e.g. saving a set) is shown to the user rather than silently retried.
      mutations: { retry: false },
    },
  });
}

// On the web, TanStack Query refetches stale queries when the browser tab regains focus. React
// Native has no window focus event, so tell it about the app returning to the foreground instead.
// setEventListener calls this once and keeps the returned cleanup function.
export function refetchOnAppForeground(): void {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => {
      setFocused(state === 'active');
    });
    return () => subscription.remove();
  });
}
