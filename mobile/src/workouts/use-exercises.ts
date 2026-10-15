import type { CreateExerciseBody, Exercise } from '@shared/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';
import { isExercise, isExerciseList } from '@/api/types';
import { useApi } from '@/auth/auth-provider';

export const EXERCISES_QUERY_KEY = ['exercises'] as const;

// Every exercise the picker can offer (GET /exercises): the built-in ones and the user's own.
// The list rarely changes, so it's considered fresh for 10 minutes: reopening the picker doesn't
// refetch it each time.
export function useExercises() {
  const api = useApi();
  return useQuery({
    queryKey: EXERCISES_QUERY_KEY,
    queryFn: () => api.request('/exercises', { guard: isExerciseList }),
    staleTime: 10 * 60 * 1000,
  });
}

// Creates a custom exercise (POST /exercises) and resolves with it.
export function useCreateExercise() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExerciseBody) =>
      api.request('/exercises', { method: 'POST', body, guard: isExercise }),
    onSuccess: (exercise) => {
      // Added to the cached list straight away, so it's there the next time the picker opens
      // without waiting for a refetch. setQueryData's updater gets the current value, which is
      // undefined if the list was never loaded; then there's nothing to add it to.
      queryClient.setQueryData<Exercise[]>(EXERCISES_QUERY_KEY, (list) =>
        list ? [...list, exercise] : list
      );
    },
    onError: (error) => {
      // 409: the server already has that name (e.g. created on another phone), so the cached list
      // is out of date. Refetching shows the existing exercise, ready to pick instead.
      if (error instanceof ApiError && error.status === 409) {
        void queryClient.invalidateQueries({ queryKey: EXERCISES_QUERY_KEY });
      }
    },
  });
}
