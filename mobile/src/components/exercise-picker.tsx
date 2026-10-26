import type { Exercise } from '@shared/models';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { CreateExerciseForm } from '@/components/create-exercise-form';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextButton } from '@/components/text-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { createExerciseName, muscleGroups, searchExercises } from '@/workouts/exercise-search';
import { useExercises } from '@/workouts/use-exercises';

export interface ExercisePickerProps {
  visible: boolean;
  onClose: () => void;
  // The picker doesn't close itself: the caller decides.
  onPick: (exercise: Exercise) => void;
  // Exercises not to offer, e.g. the ones already in the workout.
  excludeIds?: readonly number[];
  // Open another screen from here, not from onPick: iOS can't present a screen while the picker
  // is still sliding away.
  onClosed?: () => void;
}

// The New exercise form is a view inside the Modal, not a separate screen, because iOS can't
// present a screen over an open Modal.
export function ExercisePicker({
  visible,
  onClose,
  onPick,
  excludeIds = [],
  onClosed,
}: ExercisePickerProps) {
  // Android has no "dismissed" event, and doesn't need one: it can open a screen while a Modal
  // closes. So there, the picker counts as closed as soon as it's hidden.
  useEffect(() => {
    if (Platform.OS !== 'ios' && !visible) {
      onClosed?.();
    }
  }, [visible, onClosed]);

  return (
    <Modal
      testID="exercise-picker"
      visible={visible}
      animationType="slide"
      // iOS: a card over the screen that can be swiped down. Android: full screen.
      presentationStyle="pageSheet"
      // Android's back button, and the iOS swipe-down.
      onRequestClose={onClose}
      // iOS only: native code calls this when the slide-away animation has finished.
      onDismiss={onClosed}>
      {/* A Modal is a separate native window, so it needs its own safe-area provider. */}
      <SafeAreaProvider>
        {/* Only mounted while open, so the search box starts empty every time. */}
        {visible ? (
          <PickerContent onClose={onClose} onPick={onPick} excludeIds={excludeIds} />
        ) : null}
      </SafeAreaProvider>
    </Modal>
  );
}

// Without visible and onClosed, which the Modal handles.
type PickerContentProps = Required<Omit<ExercisePickerProps, 'visible' | 'onClosed'>>;

function PickerContent({ onClose, onPick, excludeIds }: PickerContentProps) {
  const theme = useTheme();
  const exercises = useExercises();
  const [query, setQuery] = useState('');
  // Set while the New exercise form shows. The query stays in state underneath, so Back returns
  // to the same search.
  const [newExerciseName, setNewExerciseName] = useState<string | null>(null);

  function results() {
    if (!exercises.data) {
      return exercises.isError ? (
        <ErrorState
          error={exercises.error}
          retrying={exercises.isFetching}
          onRetry={() => void exercises.refetch()}
        />
      ) : (
        <LoadingState label="Loading exercises" />
      );
    }
    const matches = searchExercises(exercises.data, query, excludeIds);
    const newName = createExerciseName(exercises.data, query);
    if (matches.length === 0 && newName === null) {
      return <MessageState title={query.trim() ? 'No exercises match' : 'No exercises to add'} />;
    }
    return (
      <FlatList
        data={matches}
        keyExtractor={(exercise) => String(exercise.id)}
        // Lets a tap on a result go through while the keyboard is up, instead of only closing it.
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          newName === null ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Create "${newName}"`}
              onPress={() => setNewExerciseName(newName)}
              style={({ pressed }) => [
                styles.item,
                pressed && { backgroundColor: theme.backgroundSelected },
              ]}>
              <ThemedText type="smallBold">{`Create "${newName}"`}</ThemedText>
            </Pressable>
          )
        }
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.name}
            onPress={() => onPick(item)}
            style={({ pressed }) => [
              styles.item,
              pressed && { backgroundColor: theme.backgroundSelected },
            ]}>
            <ThemedText>{item.name}</ThemedText>
            {item.muscle_group ? (
              <ThemedText type="small" themeColor="textSecondary">
                {item.muscle_group}
              </ThemedText>
            ) : null}
          </Pressable>
        )}
      />
    );
  }

  if (newExerciseName !== null) {
    return (
      <ThemedView style={styles.screen}>
        <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
          <View style={styles.header}>
            <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>
              New exercise
            </ThemedText>
            <TextButton label="Back" onPress={() => setNewExerciseName(null)} />
          </View>
          <CreateExerciseForm
            initialName={newExerciseName}
            // The form only opens from the loaded list, so `?? []` is just for the type.
            muscleGroups={muscleGroups(exercises.data ?? [])}
            onCreated={onPick}
          />
        </SafeAreaView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <ThemedText type="smallBold" accessibilityRole="header" style={styles.title}>
            Add exercise
          </ThemedText>
          <TextButton label="Cancel" onPress={onClose} />
        </View>
        <View style={styles.search}>
          <TextField
            label="Search exercises"
            placeholder="Name or muscle group"
            value={query}
            onChangeText={setQuery}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
        </View>
        {results()}
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.three,
  },
  title: { fontSize: 18 },
  search: { paddingHorizontal: Spacing.three, paddingBottom: Spacing.two },
  item: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.half },
});
