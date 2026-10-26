import type { TemplateBody, TemplateDetail } from '@shared/models';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  isExerciseLastSetsList,
  isNoContent,
  isTemplateDetail,
  isTemplateDetailList,
} from '@/api/types';
import { useApi } from '@/auth/auth-provider';

import { lastSetsPath } from './last-sets';

// Cache keys, nested like the workouts ones: invalidating ['templates'] exactly refetches the
// list, and each template has its own key under it.
export const TEMPLATES_QUERY_KEY = ['templates'] as const;

export function templateQueryKey(id: number) {
  return [...TEMPLATES_QUERY_KEY, id] as const;
}

// Every template of the logged-in user, by name (GET /templates).
export function useTemplates() {
  const api = useApi();
  return useQuery({
    queryKey: TEMPLATES_QUERY_KEY,
    queryFn: () => api.request('/templates', { guard: isTemplateDetailList }),
  });
}

// One template (GET /templates/:id). `id` is null for a route param that isn't a valid id, and
// then nothing is requested (as in useWorkout).
export function useTemplate(id: number | null) {
  const api = useApi();
  return useQuery({
    queryKey: templateQueryKey(id ?? -1),
    queryFn: () => api.request(`/templates/${id}`, { guard: isTemplateDetail }),
    enabled: id !== null,
  });
}

// Caches the saved template so opening it needs no request, and refreshes the list, whose order
// may have changed. Returning the promise makes mutateAsync wait for the fresh list.
function useCacheTemplate() {
  const queryClient = useQueryClient();
  return (template: TemplateDetail) => {
    queryClient.setQueryData(templateQueryKey(template.id), template);
    return queryClient.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY, exact: true });
  };
}

// A 409 (name taken) rejects with an ApiError whose message the form shows.
export function useCreateTemplate() {
  const api = useApi();
  const cacheTemplate = useCacheTemplate();
  return useMutation({
    mutationFn: (body: TemplateBody) =>
      api.request('/templates', { method: 'POST', body, guard: isTemplateDetail }),
    onSuccess: cacheTemplate,
  });
}

// Editing and deleting one template, like useWorkoutMutations.
export function useTemplateMutations(templateId: number) {
  const api = useApi();
  const queryClient = useQueryClient();
  const cacheTemplate = useCacheTemplate();
  const path = `/templates/${templateId}` as const;

  return {
    // PUT replaces the whole template: name and exercise list.
    updateTemplate: useMutation({
      mutationFn: (body: TemplateBody) =>
        api.request(path, { method: 'PUT', body, guard: isTemplateDetail }),
      onSuccess: cacheTemplate,
    }),

    deleteTemplate: useMutation({
      mutationFn: () => api.request(path, { method: 'DELETE', guard: isNoContent }),
      // Dropped from the cache rather than refetched, which would only 404 while the screen leaves.
      onSuccess: () => {
        queryClient.removeQueries({ queryKey: templateQueryKey(templateId), exact: true });
        return queryClient.invalidateQueries({ queryKey: TEMPLATES_QUERY_KEY, exact: true });
      },
    }),
  };
}

// Nothing is requested for no ids, which the server would reject. staleTime 0 means it refetches
// whenever the log screen opens, so a workout saved since then counts.
export function useLastSets(exerciseIds: readonly number[]) {
  const api = useApi();
  return useQuery({
    ...lastSetsQuery(api, exerciseIds),
    enabled: exerciseIds.length > 0,
  });
}

// For one exercise just picked. fetchQuery uses the cache only while it's fresh, which with
// staleTime 0 is never, so a set logged a minute ago counts.
export function useFetchLastSets() {
  const api = useApi();
  const queryClient = useQueryClient();
  return async (exerciseId: number) => {
    const lastSets = await queryClient.fetchQuery(lastSetsQuery(api, [exerciseId]));
    return lastSets[0]?.sets ?? [];
  };
}

// Shared by both, so they read and fill one cache entry per list of ids.
function lastSetsQuery(api: ReturnType<typeof useApi>, exerciseIds: readonly number[]) {
  return {
    // The ids in order: the response follows it, so [3, 1] and [1, 3] are different results.
    queryKey: ['last-sets', ...exerciseIds],
    queryFn: () => api.request(lastSetsPath(exerciseIds), { guard: isExerciseLastSetsList }),
  };
}
