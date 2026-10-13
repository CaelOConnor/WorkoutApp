import type { WorkoutDetail } from '@shared/models';
import { Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, SectionList, StyleSheet, View } from 'react-native';

import { useAuth } from '@/auth/auth-provider';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { TextButton } from '@/components/text-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatWorkoutDate, groupByWeek, localDateString } from '@/workouts/dates';
import { exerciseNames, setCountLabel } from '@/workouts/summary';
import { useWorkouts } from '@/workouts/use-workouts';

// The home screen: the user's workouts, one section per week. Only reachable while signed in.
export default function HistoryScreen() {
  const { logout } = useAuth();
  const router = useRouter();
  const workouts = useWorkouts();
  // True only during a pull-to-refresh, so the list's spinner doesn't also appear for background
  // refetches (e.g. on returning to the app), which would be distracting.
  const [refreshing, setRefreshing] = useState(false);

  async function handleRefresh() {
    setRefreshing(true);
    // refetch() doesn't throw: a failure lands in workouts.error, like any other fetch.
    await workouts.refetch();
    setRefreshing(false);
  }

  return (
    <ThemedView style={styles.screen}>
      {/* Header buttons for this screen. headerLeft/headerRight work on both iOS and Android.
          The home screen has no back button, so its left side is free for logging out. */}
      <Stack.Screen
        options={{
          headerLeft: () => <TextButton label="Log out" onPress={() => void logout()} />,
          headerRight: () => (
            <TextButton
              label="+ Log workout"
              accessibilityLabel="Log workout"
              onPress={() => router.push('/workouts/new')}
            />
          ),
        }}
      />
      {workouts.data === undefined ? (
        // No data yet: either the first load is running or it failed.
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
        // Once there's data it stays on screen, even if a later refetch fails.
        <SectionList
          testID="workout-history"
          // "Today" is taken from when the data was fetched, not from the clock during render:
          // rendering stays pure, and the labels still move on at midnight because the list is
          // refetched whenever the app comes back to the foreground.
          sections={groupByWeek(workouts.data, localDateString(new Date(workouts.dataUpdatedAt)))}
          keyExtractor={(workout) => String(workout.id)}
          renderSectionHeader={({ section }) => <WeekHeader title={section.title} />}
          renderItem={({ item }) => (
            <WorkoutRow
              workout={item}
              // A typed route: pathname must be a real route, and params must match its [id].
              onPress={() =>
                router.push({ pathname: '/workouts/[id]', params: { id: String(item.id) } })
              }
            />
          )}
          ItemSeparatorComponent={Separator}
          // Inside the list (not instead of it), so pull-to-refresh works when it's empty too.
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
    // A background, because section headers stick to the top on iOS while their rows scroll under.
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
      // One sentence for screen readers instead of three separate stops.
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
  // Lets the empty state fill the screen, so it can be centered.
  emptyContent: { flexGrow: 1 },
  sectionHeader: {
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.four,
    paddingBottom: Spacing.two,
  },
  row: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, gap: Spacing.half },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: Spacing.three },
});
