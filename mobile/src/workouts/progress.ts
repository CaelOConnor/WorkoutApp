import type { LoggedExercise, ProgressPoint, WeightUnit } from '@shared/models';

import { addMonths, dayNumber } from './dates';

// Extract fails to compile if either name stops being a key of ProgressPoint.
export type Metric = Extract<keyof ProgressPoint, 'top_weight' | 'volume'>;

export const METRICS: readonly { value: Metric; label: string }[] = [
  { value: 'top_weight', label: 'Heaviest set' },
  { value: 'volume', label: 'Volume' },
];

export const DEFAULT_METRIC: Metric = 'top_weight';

// The Range type comes from this list, so the two can't drift apart.
export const RANGES = ['3M', '6M', '1Y', 'All'] as const;
export type Range = (typeof RANGES)[number];

export const DEFAULT_RANGE: Range = '6M';

const RANGE_MONTHS: Record<Exclude<Range, 'All'>, number> = { '3M': 3, '6M': 6, '1Y': 12 };

// The first day a range includes, counting back from `today`; null for all time.
export function rangeStart(range: Range, today: string): string | null {
  return range === 'All' ? null : addMonths(today, -RANGE_MONTHS[range]);
}

// A missing unit lets the server use the exercise's most recent one. Units and dates need no
// URL encoding.
export function progressPath(
  exerciseId: number,
  { unit, from }: { unit?: WeightUnit; from?: string }
): `/${string}` {
  const params = [unit && `unit=${unit}`, from && `from=${from}`].filter(Boolean);
  return `/exercises/${exerciseId}/progress${params.length > 0 ? `?${params.join('&')}` : ''}`;
}

// x is the day number, so time gaps show as gaps. A type, not an interface, because Victory
// Native needs a Record<string, unknown>, which an interface isn't.
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

// '1,325 lb'. Grouped by hand because toLocaleString differs between JS engines.
export function formatWeightValue(value: number, unit: WeightUnit): string {
  const [whole = '', decimals] = String(value).split('.');
  // A comma before every group of three digits, counting from the end.
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
