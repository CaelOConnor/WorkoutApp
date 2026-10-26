import type { LoggedExercise } from '@shared/models';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextField } from '@/components/text-field';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { formatShortDate, localDateString } from '@/workouts/dates';
import { filterLogged } from '@/workouts/progress';
import { useLoggedExercises } from '@/workouts/use-progress';

// The Progress tab: pick a logged exercise to see its chart.
export default function ProgressListScreen() {
  const router = useRouter();
  const exercises = useLoggedExercises();
  const guard = usePressGuard();
  const [query, setQuery] = useState('');

  function content() {
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
    if (exercises.data.length === 0) {
      return (
        <MessageState title="No exercises logged yet">
          <ThemedText type="small" themeColor="textSecondary">
            Log a workout, and its exercises show up here.
          </ThemedText>
        </MessageState>
      );
    }
    const matches = filterLogged(exercises.data, query);
    if (matches.length === 0) {
      return <MessageState title="No exercises match" />;
    }
    // The year comes from when the data loaded, not the clock, so rendering stays pure.
    const currentYear = Number(localDateString(new Date(exercises.dataUpdatedAt)).slice(0, 4));
    return (
      <FlatList
        data={matches}
        keyExtractor={(exercise) => String(exercise.id)}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => (
          <ExerciseRow
            exercise={item}
            lastLogged={formatShortDate(item.last_date, currentYear)}
            onPress={() =>
              guard.navigate(() =>
                router.push({
                  pathname: '/progress/[exerciseId]',
                  params: { exerciseId: String(item.id) },
                })
              )
            }
          />
        )}
      />
    );
  }

  return (
    <ThemedView style={styles.screen}>
      <View style={styles.search}>
        <TextField
          label="Search exercises"
          placeholder="Exercise name"
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
          autoCapitalize="none"
          clearButtonMode="while-editing"
        />
      </View>
      {content()}
    </ThemedView>
  );
}

function ExerciseRow({
  exercise,
  lastLogged,
  onPress,
}: {
  exercise: LoggedExercise;
  lastLogged: string;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${exercise.name}, last logged ${lastLogged}`}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <ThemedText>{exercise.name}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        Last logged {lastLogged}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  search: { padding: Spacing.three, paddingBottom: Spacing.two },
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.half },
});
