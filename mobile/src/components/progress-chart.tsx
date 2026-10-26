// The only file that imports Victory Native and Skia, so Jest can swap it for a placeholder
// (jest.setup.ts): Skia draws on the GPU, which doesn't exist in tests.
import type { WeightUnit } from '@shared/models';
import { Circle, Line as SkiaLine, matchFont, vec } from '@shopify/react-native-skia';
import { useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useAnimatedReaction, useDerivedValue } from 'react-native-reanimated';
import { CartesianChart, Line, Scatter, useChartPressState } from 'victory-native';
import { scheduleOnRN } from 'react-native-worklets';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { dateOfDayNumber, formatShortDate } from '@/workouts/dates';
import { formatWeightValue, type ChartPoint } from '@/workouts/progress';

export interface ProgressChartProps {
  points: ChartPoint[];
  unit: WeightUnit;
  // For dates in axis labels and the readout: the year is shown only when it isn't this one.
  currentYear: number;
  // What a screen reader says for the whole chart, e.g. 'Volume chart, 12 days'.
  accessibilityLabel: string;
}

const CHART_HEIGHT = 240;

export function ProgressChart({ points, unit, currentYear, accessibilityLabel }: ProgressChartProps) {
  const theme = useTheme();
  // Skia draws the axis labels and needs its own font. matchFont uses a system font, so the app
  // needs no font file.
  const font = useMemo(
    () => matchFont({ fontFamily: Platform.select({ ios: 'Helvetica', default: 'sans-serif' }), fontSize: 12 }),
    []
  );

  // The press position lives in Reanimated shared values, which change on the UI thread without
  // re-rendering React. The initial values only set their types.
  const { state, isActive } = useChartPressState({ x: 0, y: { value: 0 } });

  // The readout is React text, so the pressed index is copied into state. scheduleOnRN moves the
  // call from the UI thread back to the JS thread, where React state lives.
  const [selected, setSelected] = useState<number | null>(null);
  useAnimatedReaction(
    () => (state.isActive.value ? state.matchedIndex.value : -1),
    (index, previous) => {
      if (index !== previous) {
        scheduleOnRN(setSelected, index >= 0 ? index : null);
      }
    }
  );

  // Skia props accept shared values and redraw when they change, without a React render.
  const top = useDerivedValue(() => vec(state.x.position.value, 0));
  const bottom = useDerivedValue(() => vec(state.x.position.value, CHART_HEIGHT));

  const selectedPoint = selected === null ? undefined : points[selected];
  const dayLabel = (day: number) => formatShortDate(dateOfDayNumber(Math.round(day)), currentYear);

  return (
    <View style={styles.container}>
      <ThemedText type="small" themeColor="textSecondary" style={styles.readout}>
        {selectedPoint
          ? `${dayLabel(selectedPoint.day)}: ${formatWeightValue(selectedPoint.value, unit)}`
          : 'Press and hold to see a day'}
      </ThemedText>
      {/* One stop for screen readers: the canvas has no text of its own to read. */}
      <View style={styles.chart} accessible accessibilityLabel={accessibilityLabel}>
        <CartesianChart
          data={points}
          xKey="day"
          yKeys={['value']}
          // Keeps the first and last dots off the axes, and the top dot off the edge.
          domainPadding={{ left: 16, right: 16, top: 24, bottom: 8 }}
          chartPressState={state}
          xAxis={{
            font,
            tickCount: 4,
            labelColor: theme.textSecondary,
            lineColor: theme.backgroundSelected,
            formatXLabel: dayLabel,
          }}
          yAxis={[
            {
              font,
              tickCount: 5,
              labelColor: theme.textSecondary,
              lineColor: theme.backgroundSelected,
              formatYLabel: (value) => String(value),
            },
          ]}>
          {({ points: plotted }) => (
            <>
              {isActive ? (
                <SkiaLine p1={top} p2={bottom} color={theme.textSecondary} strokeWidth={1} />
              ) : null}
              <Line points={plotted.value} color={theme.chart} strokeWidth={2} />
              {/* Dots, so a single workout still shows before there's a line. */}
              <Scatter points={plotted.value} radius={4} color={theme.chart} />
              {isActive ? (
                <Circle
                  cx={state.x.position}
                  cy={state.y.value.position}
                  r={6}
                  color={theme.chart}
                />
              ) : null}
            </>
          )}
        </CartesianChart>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: Spacing.two },
  readout: { textAlign: 'center' },
  chart: { height: CHART_HEIGHT },
});
