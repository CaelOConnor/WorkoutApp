import type { ExerciseProgress, ProgressPoint, WeightUnit } from '@shared/models';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ApiError } from '@/api/client';
import { Button } from '@/components/button';
import { ProgressChart } from '@/components/progress-chart';
import { ErrorState, LoadingState, MessageState } from '@/components/query-states';
import { SegmentedControl } from '@/components/segmented-control';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { UnitPicker } from '@/components/unit-picker';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatShortDate, formatWorkoutDate, localDateString } from '@/workouts/dates';
import { parseRouteId } from '@/workouts/detail';
import {
  bestPoint,
  chartPoints,
  DEFAULT_METRIC,
  DEFAULT_RANGE,
  formatWeightValue,
  isBodyweightOnly,
  METRICS,
  RANGES,
  rangeStart,
  type Metric,
  type Range,
} from '@/workouts/progress';
import { setCountLabel } from '@/workouts/summary';
import { useExerciseProgress } from '@/workouts/use-progress';

const RANGE_OPTIONS = RANGES.map((range) => ({ value: range, label: range }));

// One exercise's progress: a metric over a date range, as a chart and as a list of days.
// [exerciseId] is a dynamic segment: /progress/3 opens this for exercise 3.
export default function ProgressChartScreen() {
  const router = useRouter();
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();
  const id = parseRouteId(exerciseId);

  const [metric, setMetric] = useState<Metric>(DEFAULT_METRIC);
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  // undefined until the user picks one: the server then uses the unit last logged.
  const [unit, setUnit] = useState<WeightUnit | undefined>(undefined);
  // "Today" is fixed when the screen opens, so the range doesn't shift while it's on screen.
  // The initializer function runs only on the first render.
  const [today] = useState(() => localDateString());

  const progress = useExerciseProgress(id, { unit, from: rangeStart(range, today) ?? undefined });

  const notFound =
    id === null || (progress.error instanceof ApiError && progress.error.status === 404);
  if (notFound) {
    return (
      <ThemedView style={styles.screen}>
        <MessageState title="Exercise not found">
          <Button label="Back" variant="secondary" onPress={() => router.back()} />
        </MessageState>
      </ThemedView>
    );
  }
  if (!progress.data) {
    return (
      <ThemedView style={styles.screen}>
        {progress.isError ? (
          <ErrorState
            error={progress.error}
            retrying={progress.isFetching}
            onRetry={() => void progress.refetch()}
          />
        ) : (
          <LoadingState label="Loading progress" />
        )}
      </ThemedView>
    );
  }

  const data = progress.data;
  return (
    <ThemedView style={styles.screen}>
      <Stack.Screen options={{ title: data.exercise_name }} />
      <ScrollView contentContainerStyle={styles.content}>
        <SegmentedControl label="Metric" options={METRICS} value={metric} onChange={setMetric} />
        <View style={styles.row}>
          <View style={styles.grow}>
            <SegmentedControl
              label="Date range"
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
            />
          </View>
          {/* The unit the server answered in, which is the requested one once there is one. */}
          <UnitPicker value={data.unit} onChange={setUnit} size="compact" />
        </View>

        {/* Dimmed while another range or unit loads; the previous one stays until it arrives. */}
        <View style={[styles.content, styles.flush, progress.isPlaceholderData && styles.loading]}>
          <ProgressBody
            data={data}
            metric={metric}
            allTime={range === 'All'}
            currentYear={Number(today.slice(0, 4))}
          />
        </View>
      </ScrollView>
    </ThemedView>
  );
}

function ProgressBody({
  data,
  metric,
  allTime,
  currentYear,
}: {
  data: ExerciseProgress;
  metric: Metric;
  allTime: boolean;
  currentYear: number;
}) {
  const { points, unit } = data;
  if (points.length === 0) {
    return (
      <MessageState title="No sets in this range">
        {allTime ? null : (
          <ThemedText type="small" themeColor="textSecondary">
            Try a longer range.
          </ThemedText>
        )}
      </MessageState>
    );
  }
  if (isBodyweightOnly(points)) {
    return (
      <MessageState title="No weighted sets yet">
        <ThemedText type="small" themeColor="textSecondary">
          Every set here is at 0 weight, so there is nothing to chart.
        </ThemedText>
      </MessageState>
    );
  }

  // at(-1) is the last point, typed `ProgressPoint | undefined` even after the length check above:
  // TypeScript doesn't track array lengths. The stat tiles take an optional value instead of `!`.
  const latest = points.at(-1);
  const best = bestPoint(points, metric);
  const metricLabel = METRICS.find((m) => m.value === metric)?.label ?? metric;

  return (
    <>
      <View style={styles.row}>
        <Stat label="Latest" value={latest && formatWeightValue(latest[metric], unit)} />
        <Stat
          label="Best"
          value={best && formatWeightValue(best[metric], unit)}
          detail={best && formatShortDate(best.date, currentYear)}
        />
      </View>
      <ProgressChart
        points={chartPoints(points, metric)}
        unit={unit}
        currentYear={currentYear}
        accessibilityLabel={`${metricLabel} chart, ${points.length} ${points.length === 1 ? 'day' : 'days'}. Each day is listed below.`}
      />
      <View>
        {/* Newest first, like the history. slice() copies first: reverse() changes the array
            in place, and `points` belongs to the query cache. */}
        {points
          .slice()
          .reverse()
          .map((point) => (
            <PointRow key={point.date} point={point} value={formatWeightValue(point[metric], unit)} />
          ))}
      </View>
    </>
  );
}

function Stat({ label, value, detail }: { label: string; value?: string; detail?: string }) {
  return (
    <ThemedView type="backgroundElement" style={[styles.stat, styles.grow]}>
      <ThemedText type="small" themeColor="textSecondary">
        {label}
      </ThemedText>
      <ThemedText type="subtitle" style={styles.statValue}>
        {value ?? '–'}
      </ThemedText>
      {detail ? (
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      ) : null}
    </ThemedView>
  );
}

function PointRow({ point, value }: { point: ProgressPoint; value: string }) {
  const theme = useTheme();
  const date = formatWorkoutDate(point.date);
  const sets = setCountLabel(point.sets);
  return (
    // accessible groups the row into one stop for screen readers, read as its label.
    <View
      accessible
      accessibilityLabel={`${date}: ${value}, ${sets}`}
      style={[styles.pointRow, { borderBottomColor: theme.backgroundSelected }]}>
      <View>
        <ThemedText>{date}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {sets}
        </ThemedText>
      </View>
      <ThemedText>{value}</ThemedText>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  // The inner content block: same gap, but no second padding.
  flush: { padding: 0 },
  loading: { opacity: 0.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  grow: { flex: 1 },
  stat: { borderRadius: Spacing.three, padding: Spacing.three, gap: Spacing.half },
  statValue: { fontSize: 22, lineHeight: 28 },
  pointRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
});
