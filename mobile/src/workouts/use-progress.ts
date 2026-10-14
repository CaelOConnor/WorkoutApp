import type { WeightUnit } from '@shared/models';
import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { isExerciseProgress, isLoggedExerciseList } from '@/api/types';
import { useApi } from '@/auth/auth-provider';

import { progressPath } from './progress';

// No invalidation from the workout mutations is needed: these use the default staleTime of 0, so
// each progress screen refetches when it opens, after any change made elsewhere.
export const PROGRESS_QUERY_KEY = ['progress'] as const;

// The exercises the user has logged, most recent first (GET /exercises/logged).
export function useLoggedExercises() {
  const api = useApi();
  return useQuery({
    queryKey: [...PROGRESS_QUERY_KEY, 'logged'],
    queryFn: () => api.request('/exercises/logged', { guard: isLoggedExerciseList }),
  });
}

// One exercise's points (GET /exercises/:id/progress). `id` is null for a route param that isn't
// a valid id, and then nothing is requested (as in useWorkout).
export function useExerciseProgress(
  id: number | null,
  { unit, from }: { unit?: WeightUnit; from?: string }
) {
  const api = useApi();
  return useQuery({
    // Every input is in the key, so each unit and range is cached separately.
    queryKey: [...PROGRESS_QUERY_KEY, id ?? -1, unit ?? 'default', from ?? 'all'],
    queryFn: () => api.request(progressPath(id ?? -1, { unit, from }), { guard: isExerciseProgress }),
    enabled: id !== null,
    // While another range or unit loads, keep showing the previous one instead of a spinner.
    placeholderData: keepPreviousData,
  });
}
