import type { AddSetBody, UpdateWorkoutBody } from '@shared/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { isNoContent, isWorkoutDetail, isWorkoutDetailList } from '@/api/types';
import { useApi } from '@/auth/auth-provider';

import type { SetValues } from './forms';

// Cache keys. A workout's key starts with the list's key, so invalidating ['workouts'] (a prefix
// match) refreshes the history and every workout detail in one call. `as const` makes each key
// an exact readonly tuple instead of a loose (string | number)[].
export const WORKOUTS_QUERY_KEY = ['workouts'] as const;

export function workoutQueryKey(id: number) {
  return [...WORKOUTS_QUERY_KEY, id] as const;
}

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

// One workout with its sets (GET /workouts/:id). `id` is null for a route param that isn't a
// valid id; `enabled: false` then skips the request, and the screen shows "not found".
export function useWorkout(id: number | null) {
  const api = useApi();
  return useQuery({
    // -1 never reaches the server: it only keeps the key's type a number while disabled.
    queryKey: workoutQueryKey(id ?? -1),
    queryFn: () => api.request(`/workouts/${id}`, { guard: isWorkoutDetail }),
    enabled: id !== null,
  });
}

// Every change the detail screen and its sheets can make to one workout. Each is a useMutation:
// call mutateAsync(...) and await it; it rejects with the API client's errors for the screen to
// show. onSuccess runs before mutateAsync resolves, and returning the invalidation's promise from
// it makes the caller wait until the fresh data has arrived, so a sheet closes onto updated data.
export function useWorkoutMutations(workoutId: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  const path = `/workouts/${workoutId}` as const;

  // Marks the history and every detail stale, and refetches the ones on screen.
  const refreshAll = () => queryClient.invalidateQueries({ queryKey: WORKOUTS_QUERY_KEY });

  return {
    updateWorkout: useMutation({
      mutationFn: (body: UpdateWorkoutBody) =>
        api.request(path, { method: 'PATCH', body, guard: isWorkoutDetail }),
      onSuccess: refreshAll,
    }),

    deleteWorkout: useMutation({
      mutationFn: () => api.request(path, { method: 'DELETE', guard: isNoContent }),
      // Only the history: refetching this workout would just 404 while the screen is leaving.
      // Its cached copy is dropped by itself a few minutes after nothing shows it (gcTime).
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: WORKOUTS_QUERY_KEY, exact: true }),
    }),

    // `{ setId, values }`: a mutation function takes one argument, so several go in an object.
    updateSet: useMutation({
      mutationFn: ({ setId, values }: { setId: number; values: SetValues }) =>
        api.request(`${path}/sets/${setId}`, {
          method: 'PATCH',
          body: values,
          guard: isWorkoutDetail,
        }),
      onSuccess: refreshAll,
    }),

    deleteSet: useMutation({
      mutationFn: (setId: number) =>
        api.request(`${path}/sets/${setId}`, { method: 'DELETE', guard: isNoContent }),
      // Not awaited: the set sheet closes straight away. Waiting would re-render the sheet with
      // data that no longer has its set ("Set not found") just before it closes.
      onSuccess: () => {
        void refreshAll();
      },
    }),

    addSet: useMutation({
      mutationFn: (body: AddSetBody) =>
        api.request(`${path}/sets`, { method: 'POST', body, guard: isWorkoutDetail }),
      onSuccess: refreshAll,
    }),

    removeExercise: useMutation({
      mutationFn: (exerciseId: number) =>
        api.request(`${path}/exercises/${exerciseId}`, {
          method: 'DELETE',
          guard: isWorkoutDetail,
        }),
      onSuccess: refreshAll,
    }),
  };
}
