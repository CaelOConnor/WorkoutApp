import type { Exercise, WorkoutDetail } from '@shared/models';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { errorMessage } from '@/api/error-message';
import { Button } from '@/components/button';
import { ask, confirm } from '@/components/dialogs';
import { ExercisePicker } from '@/components/exercise-picker';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextButton } from '@/components/text-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { formatFullDate } from '@/workouts/dates';
import {
  addedSet,
  formatSetLine,
  groupSetsByExercise,
  parseRouteId,
  type ExerciseGroup,
} from '@/workouts/detail';
import { addSetBodyFrom, firstSetBody } from '@/workouts/forms';
import { setCountLabel } from '@/workouts/summary';
import { useFetchLastSets } from '@/workouts/use-templates';
import { useWorkout, useWorkoutMutations } from '@/workouts/use-workouts';

// One workout. /workouts/3 opens it with id '3'.
export default function WorkoutDetailScreen() {
  const router = useRouter();
  // The type argument isn't checked at runtime, so parseRouteId checks the value.
  const { id } = useLocalSearchParams<{ id: string }>();
  const workoutId = parseRouteId(id);
  const workout = useWorkout(workoutId);

  // A 404 isn't retried (query-client.ts), so it arrives as the error straight away.
  const notFound =
    workoutId === null || (workout.error instanceof ApiError && workout.error.status === 404);

  if (notFound) {
    return (
      <ThemedView style={styles.screen}>
        <MessageState title="Workout not found">
          <Button label="Back to history" variant="secondary" onPress={() => router.dismissTo('/')} />
        </MessageState>
      </ThemedView>
    );
  }
  return (
    <ThemedView style={styles.screen}>
      {workout.data ? (
        <WorkoutContent workout={workout.data} />
      ) : workout.isError ? (
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

// Its own component so its hooks only run once there's data. Hooks can't come after an early
// return, because they must run on every render.
function WorkoutContent({ workout }: { workout: WorkoutDetail }) {
  const router = useRouter();
  const theme = useTheme();
  const { addSet, removeExercise, deleteWorkout } = useWorkoutMutations(workout.id);
  const fetchLastSets = useFetchLastSets();
  const groups = groupSetsByExercise(workout.sets);
  const id = String(workout.id);

  // One guard for the whole screen, so no two changes, dialogs or navigations overlap.
  const guard = usePressGuard();

  // Success needs nothing here: the mutation refreshes the data and the screen re-renders.
  function change(failureTitle: string, action: Parameters<typeof guard.run>[0]) {
    void guard.run(async (leave) => {
      try {
        await action(leave);
      } catch (e: unknown) {
        Alert.alert(failureTitle, errorMessage(e));
      }
    });
  }

  // ask() doubles as a simple cross-platform menu.
  function exerciseMenuFlow(group: ExerciseGroup) {
    change('Could not remove exercise', async (leave) => {
      const choice = await ask(group.exerciseName, undefined, [
        { text: 'View progress' },
        { text: 'Remove exercise', style: 'destructive' },
        { text: 'Cancel', style: 'cancel' },
      ]);
      if (choice === 'View progress') {
        leave(() =>
          router.push({
            pathname: '/progress/[exerciseId]',
            params: { exerciseId: String(group.exerciseId) },
          })
        );
        return;
      }
      if (choice !== 'Remove exercise') {
        return;
      }
      const sure = await confirm(
        `Remove ${group.exerciseName}?`,
        `This deletes its ${setCountLabel(group.sets.length)}.`,
        'Remove'
      );
      if (sure) {
        await removeExercise.mutateAsync(group.exerciseId);
      }
    });
  }

  // The picked exercise waits here until the picker has closed. A ref, not state, since it's only
  // read in an event handler and shouldn't cause a render.
  const [pickerOpen, setPickerOpen] = useState(false);
  const picked = useRef<Exercise | null>(null);

  function addExerciseFlow() {
    const exercise = picked.current;
    picked.current = null;
    if (!exercise) {
      return; // the picker was cancelled
    }
    change('Could not add exercise', async (leave) => {
      // Only a prefill, so if last time can't be loaded the set starts at zero instead.
      const lastTime = await fetchLastSets(exercise.id).catch(() => []);
      const updated = await addSet.mutateAsync(firstSetBody(exercise.id, workout.sets, lastTime));
      const set = addedSet(workout.sets, updated.sets);
      if (set) {
        leave(() =>
          router.push({
            pathname: '/workouts/[id]/sets/[setId]',
            params: { id, setId: String(set.id) },
          })
        );
      }
    });
  }

  function deleteWorkoutFlow() {
    change('Could not delete workout', async (leave) => {
      if (!(await confirm('Delete this workout?', 'This deletes all of its sets.', 'Delete'))) {
        return;
      }
      await deleteWorkout.mutateAsync();
      // Back to the history, even if this screen was opened from a link with nothing below.
      leave(() => router.dismissTo('/'));
    });
  }

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <TextButton
              label="Edit"
              onPress={() =>
                guard.navigate(() =>
                  router.push({ pathname: '/workouts/[id]/edit', params: { id } })
                )
              }
            />
          ),
        }}
      />

      <View style={styles.heading}>
        <ThemedText type="subtitle" accessibilityRole="header" style={styles.date}>
          {formatFullDate(workout.date)}
        </ThemedText>
        {workout.notes ? <ThemedText themeColor="textSecondary">{workout.notes}</ThemedText> : null}
      </View>

      {groups.length === 0 ? (
        <ThemedText themeColor="textSecondary">No exercises in this workout yet.</ThemedText>
      ) : null}

      {groups.map((group) => {
        const lastSet = group.sets[group.sets.length - 1];
        // Only this card's button shows a spinner while its set is being added.
        const adding = addSet.isPending && addSet.variables.exercise_id === group.exerciseId;
        return (
          <ThemedView
            key={group.exerciseId}
            type="backgroundElement"
            style={styles.card}
            testID={`${group.exerciseName} card`}>
            <View style={styles.cardHeader}>
              <ThemedText type="smallBold" style={styles.exerciseName}>
                {group.exerciseName}
              </ThemedText>
              <TextButton
                label="⋯"
                accessibilityLabel={`${group.exerciseName} options`}
                onPress={() => exerciseMenuFlow(group)}
              />
            </View>

            {group.sets.map((set, index) => {
              const line = formatSetLine(set, index);
              return (
                <Pressable
                  key={set.id}
                  accessibilityRole="button"
                  accessibilityLabel={line}
                  accessibilityHint="Edit or delete this set"
                  onPress={() =>
                    guard.navigate(() =>
                      router.push({
                        pathname: '/workouts/[id]/sets/[setId]',
                        params: { id, setId: String(set.id) },
                      })
                    )
                  }
                  style={({ pressed }) => [
                    styles.setRow,
                    pressed && { backgroundColor: theme.backgroundSelected },
                  ]}>
                  <ThemedText>{line}</ThemedText>
                  <ThemedText themeColor="textSecondary">›</ThemedText>
                </Pressable>
              );
            })}

            {lastSet ? (
              <View style={styles.cardFooter}>
                <TextButton
                  label="+ Add set"
                  accessibilityLabel={`Add ${group.exerciseName} set`}
                  disabled={adding}
                  onPress={() =>
                    change('Could not add set', async () => {
                      await addSet.mutateAsync(addSetBodyFrom(lastSet));
                    })
                  }
                />
              </View>
            ) : null}
          </ThemedView>
        );
      })}

      <Button
        label="+ Add exercise"
        accessibilityLabel="Add exercise"
        variant="secondary"
        onPress={() => setPickerOpen(true)}
      />
      <ExercisePicker
        visible={pickerOpen}
        excludeIds={groups.map((g) => g.exerciseId)}
        onClose={() => setPickerOpen(false)}
        onPick={(exercise) => {
          picked.current = exercise;
          setPickerOpen(false);
        }}
        onClosed={addExerciseFlow}
      />
      {/* Hidden for an empty workout, since a template needs at least one exercise. */}
      {groups.length > 0 ? (
        <Button
          label="Save as template"
          variant="secondary"
          onPress={() =>
            guard.navigate(() =>
              router.push({ pathname: '/templates/new', params: { fromWorkout: id } })
            )
          }
        />
      ) : null}

      <View style={styles.footer}>
        <Button
          label="Delete workout"
          variant="danger"
          loading={deleteWorkout.isPending}
          onPress={deleteWorkoutFlow}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  heading: { gap: Spacing.one, paddingBottom: Spacing.two },
  date: { fontSize: 24, lineHeight: 32 },
  card: { borderRadius: Spacing.three, paddingVertical: Spacing.two },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  exerciseName: { fontSize: 16, flexShrink: 1 },
  setRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  cardFooter: {
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  footer: { paddingTop: Spacing.four },
});
