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
import { useWorkout, useWorkoutMutations } from '@/workouts/use-workouts';

// One workout: its date and notes, a card per exercise, and the ways to change them.
// [id] is a dynamic segment: /workouts/3 opens this with id '3'. Only reachable while signed in.
export default function WorkoutDetailScreen() {
  const router = useRouter();
  // URL params are always strings. The type argument describes them; it isn't checked at runtime,
  // which is why parseRouteId checks the value.
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

// A separate component so its hooks (useWorkoutMutations needs the id) only run once there's data:
// hooks must run on every render of a component, so they can't sit after an early return.
function WorkoutContent({ workout }: { workout: WorkoutDetail }) {
  const router = useRouter();
  const theme = useTheme();
  const { addSet, removeExercise, deleteWorkout } = useWorkoutMutations(workout.id);
  const groups = groupSetsByExercise(workout.sets);
  const id = String(workout.id);

  // One guard for everything on this screen: a second tap (or a tap on something else) is
  // ignored while a change, a dialog or a navigation from the first one is still going.
  const guard = usePressGuard();

  // Runs a change through the guard and shows any failure in a dialog. Success needs nothing
  // here: the mutation refreshes the data, and the screen re-renders from it.
  function change(failureTitle: string, action: Parameters<typeof guard.run>[0]) {
    void guard.run(async (leave) => {
      try {
        await action(leave);
      } catch (e: unknown) {
        Alert.alert(failureTitle, errorMessage(e));
      }
    });
  }

  // The card's menu, then a confirmation. ask() doubles as a simple cross-platform menu.
  function removeExerciseFlow(group: ExerciseGroup) {
    change('Could not remove exercise', async () => {
      const choice = await ask(group.exerciseName, undefined, [
        { text: 'Remove exercise', style: 'destructive' },
        { text: 'Cancel', style: 'cancel' },
      ]);
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

  // "+ Add exercise": the picker, then (once it has closed) the exercise's first set is saved and
  // its sheet opens to fill in the numbers. The chosen exercise waits in a ref between the two:
  // it's only read in an event handler, so it doesn't need to trigger a render like state would.
  const [pickerOpen, setPickerOpen] = useState(false);
  const picked = useRef<Exercise | null>(null);

  function addExerciseFlow() {
    const exercise = picked.current;
    picked.current = null;
    if (!exercise) {
      return; // the picker was cancelled
    }
    change('Could not add exercise', async (leave) => {
      const updated = await addSet.mutateAsync(firstSetBody(exercise.id, workout.sets));
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
                onPress={() => removeExerciseFlow(group)}
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
