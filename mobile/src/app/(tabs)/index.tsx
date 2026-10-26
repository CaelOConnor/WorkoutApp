import type { WorkoutDetail } from '@shared/models';
import { Tabs, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextButton } from '@/components/text-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { usePressGuard } from '@/hooks/use-press-guard';
import { useTheme } from '@/hooks/use-theme';
import { formatWorkoutDate, groupByWeek, localDateString } from '@/workouts/dates';
import { exerciseNames, setCountLabel } from '@/workouts/summary';
import { useWorkouts } from '@/workouts/use-workouts';

// The History tab: the user's workouts, grouped by week.
export default function HistoryScreen() {
  const { logout } = useAuth();
  const router = useRouter();
  const workouts = useWorkouts();
  // Ignores a second tap while the first one is still opening a screen.
  const guard = usePressGuard();
  // Only true during pull-to-refresh, so background refreshes don't show a spinner.
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    await workouts.refetch(); // a failure shows up in workouts.error, it doesn't throw
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.screen}>
      {/* Header buttons. Tabs.Screen because this screen is a tab. */}
      <Tabs.Screen
        options={{
          headerLeft: () => <TextButton label="Log out" onPress={() => void logout()} />,
          headerRight: () => (
            <TextButton
              label="+ Log workout"
              accessibilityLabel="Log workout"
              // Opens a sheet: start empty or from a template.
              onPress={() => guard.navigate(() => router.push('/workouts/start'))}
            />
          ),
        }}
      />
      {workouts.data === undefined ? (
        // No data yet: still loading, or the first load failed.
        workouts.isError ? (
          <ErrorState
            error={workouts.error}
            retrying={workouts.isFetching}
            onRetry={() => void workouts.refetch()}
          />
        ) : (
          <LoadingState label="Loading workouts" />
        )
      ) : (
        // Once loaded, the list stays on screen even if a later refresh fails.
        <SectionList
          testID="workout-history"
          // "Today" comes from when the data was loaded, not the current clock.
          // The list reloads when the app reopens, so labels still update after midnight.
          sections={groupByWeek(workouts.data, localDateString(new Date(workouts.dataUpdatedAt)))}
          keyExtractor={(workout) => String(workout.id)}
          renderSectionHeader={({ section }) => <WeekHeader title={section.title} />}
          renderItem={({ item }) => (
            <WorkoutRow
              workout={item}
              onPress={() =>
                guard.navigate(() =>
                  router.push({ pathname: '/workouts/[id]', params: { id: String(item.id) } })
                )
              }
            />
          )}
          ItemSeparatorComponent={Separator}
          // Inside the list, so pull-to-refresh still works when there are no workouts.
          ListEmptyComponent={EmptyState}
          contentContainerStyle={workouts.data.length === 0 && styles.emptyContent}
          refreshing={refreshing}
          onRefresh={() => void handleRefresh()}
        />
      )}
    </ThemedView>
  );
}

function WeekHeader({ title }: { title: string }) {
  return (
    // Has a background because headers stick to the top on iOS while rows scroll under them.
    <ThemedView style={styles.sectionHeader}>
      <ThemedText type="smallBold" themeColor="textSecondary" accessibilityRole="header">
        {title}
      </ThemedText>
    </ThemedView>
  );
}

function WorkoutRow({ workout, onPress }: { workout: WorkoutDetail; onPress: () => void }) {
  const theme = useTheme();
  const date = formatWorkoutDate(workout.date);
  const names = exerciseNames(workout.sets);
  const setCount = setCountLabel(workout.sets.length);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // Read as one sentence by screen readers.
      accessibilityLabel={`${date}, ${names}, ${setCount}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: theme.backgroundSelected }]}>
      <View style={styles.rowTop}>
        <ThemedText>{date}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {setCount}
        </ThemedText>
      </View>
      <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
        {names}
      </ThemedText>
    </Pressable>
  );
}

function Separator() {
  const theme = useTheme();
  return <View style={[styles.separator, { backgroundColor: theme.backgroundSelected }]} />;
}

function EmptyState() {
  return (
    <MessageState title="No workouts yet">
      <ThemedText type="small" themeColor="textSecondary">
        Tap + Log workout to add your first one.
      </ThemedText>
    </MessageState>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  emptyContent: { flexGrow: 1 }, // lets the empty message fill the screen, so it can be centered
  sectionHeader: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.half },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
});