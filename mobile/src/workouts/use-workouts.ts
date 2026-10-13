import { useQuery } from '@tanstack/react-query';

import { isWorkoutDetailList } from '@/api/types';
import { useApi } from '@/auth/auth-provider';

// The cache key for GET /workouts. Screens that change workouts (logging, editing, deleting)
// invalidate it so the history refetches. `as const` makes the type the exact tuple
// readonly ['workouts'] instead of string[].
export const WORKOUTS_QUERY_KEY = ['workouts'] as const;

// Every workout of the logged-in user, newest first (GET /workouts). useQuery caches the result,
// shares it between screens, and refetches it when the app returns to the foreground.
export function useWorkouts() {
  const api = useApi();
  return useQuery({
    queryKey: WORKOUTS_QUERY_KEY,
    // The guard makes request() return Promise<WorkoutDetail[]>, so `data` is typed from it.
    queryFn: () => api.request('/workouts', { guard: isWorkoutDetailList }),
  });
}
