// TanStack Query setup: when to retry failed requests and when to refresh data.
import { focusManager, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

import { ApiError, NetworkError } from './client';

const MAX_RETRIES = 2;

// Only retry failures that might fix themselves: no connection, or a server error.
// A 4xx would just fail the same way again.
export function shouldRetry(failureCount: number, error: Error): boolean {
  const transient =
    error instanceof NetworkError || (error instanceof ApiError && error.status >= 500);
  return transient && failureCount < MAX_RETRIES;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: shouldRetry },
      // Never retry saves: a retry after a timeout could save the same thing twice.
      mutations: { retry: false },
    },
  });
}

// Refresh data when the app comes back to the foreground.
// Phones have no browser-tab focus event, so this listens for the app becoming active instead.
export function refetchOnAppForeground(): void {
  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (state) => {
      setFocused(state === 'active');
    });
    return () => subscription.remove();
  });
}