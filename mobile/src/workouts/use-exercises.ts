import type { CreateExerciseBody, Exercise } from '@shared/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { ApiError } from '@/api/client';
import { isExercise, isExerciseList } from '@/api/types';
import { useApi } from '@/auth/auth-provider';

export const EXERCISES_QUERY_KEY = ['exercises'] as const;

// The built-in exercises and the user's own. Fresh for 10 minutes, since the list rarely changes.
export function useExercises() {
  const api = useApi();
  return useQuery({
    queryKey: EXERCISES_QUERY_KEY,
    queryFn: () => api.request('/exercises', { guard: isExerciseList }),
    staleTime: 10 * 60 * 1000,
  });
}

export function useCreateExercise() {
  const api = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateExerciseBody) =>
      api.request('/exercises', { method: 'POST', body, guard: isExercise }),
    onSuccess: (exercise) => {
      // Added to the cached list so the picker shows it without a refetch. The list is undefined
      // if it was never loaded, and then there's nothing to add to.
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
