import type { AddSetBody, CreateWorkoutBody, UpdateWorkoutBody } from '@shared/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  isCreateWorkoutResponse,
  isNoContent,
  isWorkoutDetail,
  isWorkoutDetailList,
} from '@/api/types';
import { useApi } from '@/auth/auth-provider';

import type { SetValues } from './forms';

// Cache keys. A workout's key starts with the list's key, so refreshing ['workouts']
// refreshes the history and every workout at once.
export const WORKOUTS_QUERY_KEY = ['workouts'] as const;

export function workoutQueryKey(id: number) {
  return [...WORKOUTS_QUERY_KEY, id] as const;
}

// All of the user's workouts, cached and shared between screens.
export function useWorkouts() {
  const api = useApi();
  return useQuery({
    queryKey: WORKOUTS_QUERY_KEY,
    queryFn: () => api.request('/workouts', { guard: isWorkoutDetailList }),
  });
}

// One workout. id is null when the URL's id is invalid, and then nothing is fetched.
export function useWorkout(id: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: workoutQueryKey(id ?? -1), // -1 is never fetched, it just keeps the key a number
    queryFn: () => api.request(`/workouts/${id}`, { guard: isWorkoutDetail }),
    enabled: id !== null,
  });
}

// Saves a new workout and returns its id.
export function useCreateWorkout() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateWorkoutBody) =>
      api.request('/workouts', { method: 'POST', body, guard: isCreateWorkoutResponse }),
    // Not waited on: the app opens the new workout right away while the history refreshes.
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: WORKOUTS_QUERY_KEY });
    },
  });
}

// Every change the workout screen can make. Each one refreshes the data afterward.
// Returning the refresh makes the caller wait for fresh data, so a sheet closes onto updated data.
export function useWorkoutMutations(workoutId: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  const path = `/workouts/${workoutId}` as const;

  const refreshAll = () => queryClient.invalidateQueries({ queryKey: WORKOUTS_QUERY_KEY });

  return {
    updateWorkout: useMutation({
      mutationFn: (body: UpdateWorkoutBody) =>
        api.request(path, { method: 'PATCH', body, guard: isWorkoutDetail }),
      onSuccess: refreshAll,
    }),

    deleteWorkout: useMutation({
      mutationFn: () => api.request(path, { method: 'DELETE', guard: isNoContent }),
      // Only refresh the history: reloading the deleted workout would just 404.
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: WORKOUTS_QUERY_KEY, exact: true }),
    }),

    // A mutation takes one argument, so several values go in an object.
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
      // Not waited on, so the sheet closes before it could show "Set not found".
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