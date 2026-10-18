import type { WorkoutDetail } from '@shared/models';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet } from 'react-native';

import { ApiError } from '@/api/client';
import { Button } from '@/components/button';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TemplateEditor } from '@/components/template-editor';
import { ThemedView } from '@/components/themed-view';
import { parseRouteId } from '@/workouts/detail';
import {
  createTemplateForm,
  MAX_SET_COUNT,
  templateFromWorkout,
  type TemplateForm,
} from '@/workouts/template-form';
import { useCreateTemplate } from '@/workouts/use-templates';
import { useWorkout } from '@/workouts/use-workouts';

// A new template, saved with POST /templates. Two ways in:
// - "+ New template" on the Templates tab: an empty form.
// - "Save as template" on a workout: /templates/new?fromWorkout=3, the form prefilled from it.
// Only reachable while signed in.
export default function NewTemplateScreen() {
  // A query param arrives like a path param: a string, a string[] if repeated, or undefined.
  const { fromWorkout } = useLocalSearchParams<{ fromWorkout?: string }>();

  if (fromWorkout === undefined) {
    return <NewTemplateForm initial={createTemplateForm()} />;
  }
  return <FromWorkout workoutId={parseRouteId(fromWorkout)} />;
}

// Waits for the workout (normally already cached by its detail screen, so no request), then
// opens the form built from it.
function FromWorkout({ workoutId }: { workoutId: number | null }) {
  const router = useRouter();
  const workout = useWorkout(workoutId);

  const notFound =
    workoutId === null || (workout.error instanceof ApiError && workout.error.status === 404);

  if (notFound) {
    return (
      <ThemedView style={styles.screen}>
        <MessageState title="Workout not found">
          <Button label="Go back" variant="secondary" onPress={() => router.back()} />
        </MessageState>
      </ThemedView>
    );
  }
  if (workout.data) {
    return <WorkoutTemplateForm workout={workout.data} />;
  }
  return (
    <ThemedView style={styles.screen}>
      {workout.isError ? (
        <ErrorState
          error={workout.error}
          retrying={workout.isFetching}
          onRetry={() => void workout.refetch()}
        />
      ) : (
        <LoadingState label="Loading workout" />
      )}
    </ThemedView>
  );
}

// Its own component so the form is built once, from the workout as it was when the form opened.
function WorkoutTemplateForm({ workout }: { workout: WorkoutDetail }) {
  const [{ form, cappedExercises }] = useState(() => templateFromWorkout(workout));
  return <NewTemplateForm initial={form} notice={cappedNote(cappedExercises)} />;
}

// "Squat had more than 20 sets; ..." for the exercises templateFromWorkout capped, or null.
function cappedNote(names: readonly string[]): string | null {
  if (names.length === 0) {
    return null;
  }
  const them = names.length === 1 ? 'it starts' : 'they start';
  return `${names.join(', ')} had more than ${MAX_SET_COUNT} sets. A template holds up to ${MAX_SET_COUNT} per exercise, so ${them} at ${MAX_SET_COUNT}.`;
}

function NewTemplateForm({ initial, notice }: { initial: TemplateForm; notice?: string | null }) {
  const router = useRouter();
  const createTemplate = useCreateTemplate();
  // Kept from the first render: the editor compares against it to know whether anything changed.
  const [start] = useState(initial);

  return (
    <TemplateEditor
      initial={start}
      notice={notice}
      save={(body) => createTemplate.mutateAsync(body)}
      saving={createTemplate.isPending}
      // replace, not push: back from the new template goes to where the form was opened from
      // (the list, or the workout), not to this form.
      onSaved={(template) =>
        router.replace({ pathname: '/templates/[id]', params: { id: String(template.id) } })
      }
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
});
