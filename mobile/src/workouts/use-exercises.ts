import { useQuery } from '@tanstack/react-query';

import { isExerciseList } from '@/api/types';
import { useApi } from '@/auth/auth-provider';

export const EXERCISES_QUERY_KEY = ['exercises'] as const;

// Every exercise the picker can offer (GET /exercises). The list rarely changes, so it's
// considered fresh for 10 minutes: reopening the picker doesn't refetch it each time.
export function useExercises() {
  const api = useApi();
  return useQuery({
    queryKey: EXERCISES_QUERY_KEY,
    queryFn: () => api.request('/exercises', { guard: isExerciseList }),
    staleTime: 10 * 60 * 1000,
  });
}
