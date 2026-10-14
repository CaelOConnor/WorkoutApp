import type { LoggedExercise, ProgressPoint } from '@shared/models';

import { dayNumber } from './dates';
import {
  bestPoint,
  chartPoints,
  filterLogged,
  formatWeightValue,
  isBodyweightOnly,
  progressPath,
  rangeStart,
} from './progress';

function point(overrides: Partial<ProgressPoint>): ProgressPoint {
  return { date: '2026-09-01', top_weight: 100, e1rm: 116.7, volume: 500, sets: 1, ...overrides };
}

describe('rangeStart', () => {
  // it.each with a tagged template: one row per line, columns named in the header.
  it.each`
    range    | start
    ${'3M'}  | ${'2026-07-14'}
    ${'6M'}  | ${'2026-04-14'}
    ${'1Y'}  | ${'2025-10-14'}
    ${'All'} | ${null}
  `('gives $start for $range', ({ range, start }) => {
    expect(rangeStart(range, '2026-10-14')).toBe(start);
  });
});

describe('progressPath', () => {
  it('leaves out what is not set, so the server uses its defaults', () => {
    expect(progressPath(4, {})).toBe('/exercises/4/progress');
  });

  it('adds the unit and start date', () => {
    expect(progressPath(4, { unit: 'kg', from: '2026-04-14' })).toBe(
      '/exercises/4/progress?unit=kg&from=2026-04-14'
    );
    expect(progressPath(4, { from: '2026-04-14' })).toBe('/exercises/4/progress?from=2026-04-14');
  });
});

describe('chartPoints', () => {
  const points = [
    point({ date: '2026-09-01', e1rm: 121, volume: 950 }),
    point({ date: '2026-09-03', e1rm: 126.7, volume: 1325 }),
  ];

  it("gives each point's day number and the chosen metric", () => {
    // Day numbers, not indexes: a two-week gap between workouts shows as a gap on the chart.
    expect(chartPoints(points, 'e1rm')).toEqual([
      { day: dayNumber('2026-09-01'), value: 121 },
      { day: dayNumber('2026-09-03'), value: 126.7 },
    ]);
    expect(chartPoints(points, 'volume').map((p) => p.value)).toEqual([950, 1325]);
  });
});

describe('bestPoint', () => {
  it('finds the highest value for the metric, the earliest one on a tie', () => {
    const points = [
      point({ date: '2026-09-01', top_weight: 120, volume: 900 }),
      point({ date: '2026-09-03', top_weight: 110, volume: 1300 }),
      point({ date: '2026-09-05', top_weight: 120, volume: 800 }),
    ];
    expect(bestPoint(points, 'top_weight')?.date).toBe('2026-09-01');
    expect(bestPoint(points, 'volume')?.date).toBe('2026-09-03');
  });

  it('is undefined with no points', () => {
    expect(bestPoint([], 'e1rm')).toBeUndefined();
  });
});

describe('formatWeightValue', () => {
  it('shows the number with its unit, grouping thousands', () => {
    expect(formatWeightValue(126.7, 'lb')).toBe('126.7 lb');
    expect(formatWeightValue(0, 'kg')).toBe('0 kg');
    expect(formatWeightValue(1325, 'lb')).toBe('1,325 lb');
    expect(formatWeightValue(1234567.5, 'kg')).toBe('1,234,567.5 kg');
  });
});

describe('isBodyweightOnly', () => {
  it('is true when every point has zero weight', () => {
    expect(isBodyweightOnly([point({ top_weight: 0 }), point({ top_weight: 0 })])).toBe(true);
  });

  it('is false with any weighted point, or with none at all', () => {
    expect(isBodyweightOnly([point({ top_weight: 0 }), point({ top_weight: 20 })])).toBe(false);
    expect(isBodyweightOnly([])).toBe(false);
  });
});

describe('filterLogged', () => {
  const logged: LoggedExercise[] = [
    { id: 1, name: 'Squat', last_date: '2026-09-03', unit: 'kg' },
    { id: 2, name: 'Front Squat', last_date: '2026-09-02', unit: 'lb' },
    { id: 3, name: 'Bench Press', last_date: '2026-09-01', unit: 'lb' },
  ];

  it('matches part of the name, ignoring case, and keeps the most-recent-first order', () => {
    expect(filterLogged(logged, ' SQUAT ').map((e) => e.id)).toEqual([1, 2]);
  });

  it('returns everything for an empty query', () => {
    expect(filterLogged(logged, '')).toEqual(logged);
  });
});
