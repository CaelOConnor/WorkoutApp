import type { ExerciseLastSets, TemplateBody, TemplateDetail } from '@shared/models';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import type { PropsWithChildren } from 'react';

import { AuthProvider, useAuth } from '@/auth/auth-provider';
import { TOKEN_KEY } from '@/auth/token-storage';
import { jsonResponse, mockApi, noContentResponse, requestsMade } from '@/test-utils/mock-api';

import {
  templateQueryKey,
  useCreateTemplate,
  useLastSets,
  useTemplate,
  useTemplateMutations,
  useTemplates,
} from './use-templates';

jest.mock('@/api/config', () => ({ getApiUrl: () => 'http://api.test' }));
jest.mock('expo-secure-store');

const legDay = {
  id: 4,
  name: 'Leg day',
  exercises: [
    { exercise_id: 1, exercise_name: 'Squat', set_count: 3 },
    { exercise_id: 2, exercise_name: 'Leg Press', set_count: 2 },
  ],
} satisfies TemplateDetail;

const push = {
  id: 5,
  name: 'Push',
  exercises: [{ exercise_id: 3, exercise_name: 'Bench Press', set_count: 5 }],
} satisfies TemplateDetail;

beforeEach(async () => {
  // Signed in, so the hooks render the way the app's signed-in screens do.
  await SecureStore.setItemAsync(TOKEN_KEY, 'tok');
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Renders `hook` inside the app's providers, once signed in (as the app only shows these screens
// then). result.current is undefined until that first render.
async function setup<T>(hook: () => T) {
  // retry: false so a failing request fails the test at once. gcTime: Infinity so unmounted queries
  // don't start 5-minute cleanup timers, which would keep Jest from exiting.
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  function SignedIn({ children }: PropsWithChildren) {
    return useAuth().status === 'signedIn' ? children : null;
  }
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SignedIn>{children}</SignedIn>
        </AuthProvider>
      </QueryClientProvider>
    );
  }
  const { result } = await renderHook(hook, { wrapper: Wrapper });
  await waitFor(() => expect(result.current).toBeDefined());
  return { result, queryClient: client };
}

describe('useTemplates', () => {
  it('loads the list (GET /templates)', async () => {
    mockApi({ 'GET /templates': () => jsonResponse(200, [legDay, push]) });

    const { result } = await setup(() => useTemplates());

    await waitFor(() => expect(result.current.data).toEqual([legDay, push]));
  });

  it('fails with a response the guard rejects', async () => {
    mockApi({ 'GET /templates': () => jsonResponse(200, [{ ...legDay, exercises: [] }]) });

    const { result } = await setup(() => useTemplates());

    await waitFor(() => expect(result.current.isError).toBe(true));
  });
});

describe('useTemplate', () => {
  it('loads one template (GET /templates/:id)', async () => {
    mockApi({ 'GET /templates/4': () => jsonResponse(200, legDay) });

    const { result } = await setup(() => useTemplate(4));

    await waitFor(() => expect(result.current.data).toEqual(legDay));
  });

  it('requests nothing for a null id', async () => {
    const fetchMock = mockApi({});

    const { result } = await setup(() => useTemplate(null));

    expect(result.current.fetchStatus).toBe('idle');
    expect(requestsMade(fetchMock)).toEqual([]);
  });
});

describe('useCreateTemplate', () => {
  it('posts the body, caches the new template, and refetches the list', async () => {
    const body: TemplateBody = {
      name: 'Push',
      exercises: [{ exercise_id: 3, set_count: 5 }],
    };
    let posted: unknown;
    let list: TemplateDetail[] = [legDay];
    const fetchMock = mockApi({
      'GET /templates': () => jsonResponse(200, list),
      'POST /templates': ({ body: sent }) => {
        posted = sent;
        list = [legDay, push];
        return jsonResponse(201, push);
      },
    });
    // The list is on screen (observed) while the mutation runs, as on the Templates tab.
    const { result, queryClient } = await setup(() => ({
      list: useTemplates(),
      create: useCreateTemplate(),
    }));
    await waitFor(() => expect(result.current.list.data).toEqual([legDay]));

    // act(): the mutation updates React state, which must happen inside act() in tests.
    let created: TemplateDetail | undefined;
    await act(async () => {
      created = await result.current.create.mutateAsync(body);
    });

    expect(posted).toEqual(body);
    expect(created).toEqual(push);
    // Opening the new template needs no request: it's cached under its own key.
    expect(queryClient.getQueryData(templateQueryKey(push.id))).toEqual(push);
    await waitFor(() => expect(result.current.list.data).toEqual([legDay, push]));
    expect(requestsMade(fetchMock)).toEqual(['GET /templates', 'POST /templates', 'GET /templates']);
  });
});

describe('useTemplateMutations', () => {
  it('updateTemplate puts the body, replaces the cached template, and refetches the list', async () => {
    const renamed = { ...legDay, name: 'Legs' };
    let list: TemplateDetail[] = [legDay];
    let put: unknown;
    const fetchMock = mockApi({
      'GET /templates': () => jsonResponse(200, list),
      'GET /templates/4': () => jsonResponse(200, legDay),
      'PUT /templates/4': ({ body }) => {
        put = body;
        list = [renamed];
        return jsonResponse(200, renamed);
      },
    });
    const { result } = await setup(() => ({
      list: useTemplates(),
      template: useTemplate(4),
      mutations: useTemplateMutations(4),
    }));
    await waitFor(() => expect(result.current.template.data).toEqual(legDay));

    const body: TemplateBody = {
      name: 'Legs',
      exercises: [
        { exercise_id: 1, set_count: 3 },
        { exercise_id: 2, set_count: 2 },
      ],
    };
    await act(async () => {
      await result.current.mutations.updateTemplate.mutateAsync(body);
    });

    expect(put).toEqual(body);
    // From the PUT's response, not a second GET /templates/4.
    expect(result.current.template.data).toEqual(renamed);
    await waitFor(() => expect(result.current.list.data).toEqual([renamed]));
    expect(requestsMade(fetchMock).filter((r) => r === 'GET /templates/4')).toHaveLength(1);
  });

  it('deleteTemplate deletes it, drops it from the cache, and refetches the list', async () => {
    let list: TemplateDetail[] = [legDay, push];
    const fetchMock = mockApi({
      'GET /templates': () => jsonResponse(200, list),
      'DELETE /templates/4': () => {
        list = [push];
        return noContentResponse();
      },
    });
    const { result, queryClient } = await setup(() => ({
      list: useTemplates(),
      mutations: useTemplateMutations(4),
    }));
    await waitFor(() => expect(result.current.list.data).toEqual([legDay, push]));
    queryClient.setQueryData(templateQueryKey(4), legDay);

    await act(async () => {
      await result.current.mutations.deleteTemplate.mutateAsync();
    });

    // Removed rather than refetched: a refetch would only 404.
    expect(queryClient.getQueryData(templateQueryKey(4))).toBeUndefined();
    await waitFor(() => expect(result.current.list.data).toEqual([push]));
    expect(requestsMade(fetchMock)).not.toContain('GET /templates/4');
  });
});

describe('useLastSets', () => {
  const squatLast = {
    exercise_id: 1,
    date: '2026-10-08',
    sets: [{ reps: 5, weight: 225, unit: 'lb' }],
  } satisfies ExerciseLastSets;

  it('loads last time for the ids, in the order given (GET /exercises/last-sets?ids=)', async () => {
    const fetchMock = mockApi({
      'GET /exercises/last-sets?ids=3,1': () => jsonResponse(200, [squatLast]),
    });

    const { result } = await setup(() => useLastSets([3, 1]));

    await waitFor(() => expect(result.current.data).toEqual([squatLast]));
    expect(requestsMade(fetchMock)).toEqual(['GET /exercises/last-sets?ids=3,1']);
  });

  it('requests nothing for no ids (the server would answer 400)', async () => {
    const fetchMock = mockApi({});

    const { result } = await setup(() => useLastSets([]));

    expect(result.current.fetchStatus).toBe('idle');
    expect(requestsMade(fetchMock)).toEqual([]);
  });
});
