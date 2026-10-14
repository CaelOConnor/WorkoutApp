// Pure logic for the progress screens: which metric and date range to show, the request path,
// and turning points into chart data and text. Kept out of the screens so it's unit-tested.
import type { LoggedExercise, ProgressPoint, WeightUnit } from '@shared/models';

import { addMonths, dayNumber } from './dates';

// The three numbers each point carries. Extract<keyof X, ...> keeps only the listed keys, and
// fails to compile if one of them stops being a key of ProgressPoint.
export type Metric = Extract<keyof ProgressPoint, 'e1rm' | 'top_weight' | 'volume'>;

export const METRICS: readonly { value: Metric; label: string }[] = [
  { value: 'e1rm', label: 'Est. 1RM' },
  { value: 'top_weight', label: 'Heaviest set' },
  { value: 'volume', label: 'Volume' },
];

export const DEFAULT_METRIC: Metric = 'e1rm';

// `as const` makes this a tuple of literals, and (typeof RANGES)[number] is the union of its
// elements: '3M' | '6M' | '1Y' | 'All'. The type is derived from the list, so they can't drift.
export const RANGES = ['3M', '6M', '1Y', 'All'] as const;
export type Range = (typeof RANGES)[number];

export const DEFAULT_RANGE: Range = '6M';

const RANGE_MONTHS: Record<Exclude<Range, 'All'>, number> = { '3M': 3, '6M': 6, '1Y': 12 };

// The first day a range includes, counting back from `today`; null for all time.
export function rangeStart(range: Range, today: string): string | null {
  return range === 'All' ? null : addMonths(today, -RANGE_MONTHS[range]);
}

// GET /exercises/:id/progress with only the parameters that are set: a missing unit lets the
// server use the exercise's most recent one. Values are a unit or a 'YYYY-MM-DD' date, neither
// of which needs URL encoding. The return type is a template literal type, "a string starting
// with /", which is what the API client's request() accepts as a path.
export function progressPath(
  exerciseId: number,
  { unit, from }: { unit?: WeightUnit; from?: string }
): `/${string}` {
  const params = [unit && `unit=${unit}`, from && `from=${from}`].filter(Boolean);
  return `/exercises/${exerciseId}/progress${params.length > 0 ? `?${params.join('&')}` : ''}`;
}

// What the chart plots: x is the day number (so time gaps show as gaps), y the chosen metric.
// A type alias, not an interface: Victory Native needs its data to be a Record<string, unknown>,
// which an interface isn't (interfaces can be extended later, so TS won't assume no other keys).
export type ChartPoint = { day: number; value: number };

export function chartPoints(points: readonly ProgressPoint[], metric: Metric): ChartPoint[] {
  return points.map((p) => ({ day: dayNumber(p.date), value: p[metric] }));
}

// The point with the highest value for the metric; the earliest one on a tie.
export function bestPoint(
  points: readonly ProgressPoint[],
  metric: Metric
): ProgressPoint | undefined {
  // reduce without a start value would throw on an empty array, so start from undefined.
  return points.reduce<ProgressPoint | undefined>(
    (best, p) => (best === undefined || p[metric] > best[metric] ? p : best),
    undefined
  );
}

// '1,325 lb'. The thousands are grouped by hand rather than with toLocaleString, whose output
// depends on the JS engine's Intl data (see formatWorkoutDate in dates.ts).
export function formatWeightValue(value: number, unit: WeightUnit): string {
  const [whole = '', decimals] = String(value).split('.');
  // (?=(\d{3})+$) matches a position followed by a multiple of 3 digits up to the end; \B keeps
  // it from matching at the very start.
  const grouped = whole.replace(/\B(?=(\d{3})+$)/g, ',');
  return `${decimals ? `${grouped}.${decimals}` : grouped} ${unit}`;
}

// True when there are points but none has any weight (pull-ups, say): every metric is 0, so a
// chart would be a flat line.
export function isBodyweightOnly(points: readonly ProgressPoint[]): boolean {
  return points.length > 0 && points.every((p) => p.top_weight === 0);
}

// The picker's search: part of the name, ignoring case and surrounding spaces. Keeps the server's
// order (most recently logged first), which is what the list shows.
export function filterLogged(
  exercises: readonly LoggedExercise[],
  query: string
): LoggedExercise[] {
  const needle = query.trim().toLowerCase();
  return exercises.filter((e) => e.name.toLowerCase().includes(needle));
}
