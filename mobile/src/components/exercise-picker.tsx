import type { Exercise } from '@shared/models';
import { useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextButton } from '@/components/text-button';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { searchExercises } from '@/workouts/exercise-search';
import { useExercises } from '@/workouts/use-exercises';

export interface ExercisePickerProps {
  visible: boolean;
  onClose: () => void;
  // Called with the chosen exercise. The picker doesn't close itself: the caller decides.
  onPick: (exercise: Exercise) => void;
  // Exercises not to offer, e.g. the ones already in the workout.
  excludeIds?: readonly number[];
}

// Choose one exercise from GET /exercises, with a search box. Self-contained (it loads its own
// data) and shown in a Modal, so any screen can use it: logging a new workout now, and adding an
// exercise to an existing one later.
export function ExercisePicker({ visible, onClose, onPick, excludeIds = [] }: ExercisePickerProps) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      // iOS: a card over the screen that can be swiped down. Android: full screen.
      presentationStyle="pageSheet"
      // Android's back button, and the iOS swipe-down.
      onRequestClose={onClose}>
      {/* A Modal is a separate native window, so it needs its own provider for safe-area
          insets (e.g. the status bar on Android). */}
      <SafeAreaProvider>
        {/* Only mounted while open, so the search box starts empty every time. */}
        {visible ? (
          <PickerContent onClose={onClose} onPick={onPick} excludeIds={excludeIds} />
        ) : null}
      </SafeAreaProvider>
    </Modal>
  );
}

// Required<Omit<...>>: the picker's props without `visible`, with excludeIds no longer optional.
type PickerContentProps = Required<Omit<ExercisePickerProps, 'visible'>>;

function PickerContent({ onClose, onPick, excludeIds }: PickerContentProps) {
  const theme = useTheme();
  const exercises = useExercises();
  const [query, setQuery] = useState('');

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
    if (matches.length === 0) {
      return <MessageState title={query.trim() ? 'No exercises match' : 'No exercises to add'} />;
    }
    return (
      <FlatList
        data={matches}
        keyExtractor={(exercise) => String(exercise.id)}
        // Lets a tap on a result go through while the keyboard is up, instead of only closing it.
        keyboardShouldPersistTaps="handled"
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
