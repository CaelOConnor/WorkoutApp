import { addDays, formatWorkoutDate, groupByWeek, localDateString, startOfWeek } from './dates';

// groupByWeek only reads `date`, so test items can be this small (see the generic in dates.ts).
function w(id: number, date: string) {
  return { id, date };
}

// Reference calendar: 2026-10-12 is a Monday, 2026-10-18 a Sunday. 2026-01-01 is a Thursday.

describe('startOfWeek', () => {
  it('returns the Monday of the week, Monday itself included', () => {
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12'); // Monday
    expect(startOfWeek('2026-10-14')).toBe('2026-10-12'); // Wednesday
  });

  it('puts Sunday in the week that started the Monday before, not the next one', () => {
    expect(startOfWeek('2026-10-18')).toBe('2026-10-12');
    expect(startOfWeek('2026-10-11')).toBe('2026-10-05');
  });

  it('crosses month and year boundaries', () => {
    expect(startOfWeek('2026-11-01')).toBe('2026-10-26'); // Sunday 1 Nov
    expect(startOfWeek('2026-01-01')).toBe('2025-12-29'); // Thursday
    expect(startOfWeek('2024-03-01')).toBe('2024-02-26'); // leap year February
  });
});

describe('addDays', () => {
  it('adds and subtracts across month, year and leap-day boundaries', () => {
    expect(addDays('2026-10-12', 7)).toBe('2026-10-19');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01');
  });
});

describe('localDateString', () => {
  it("formats a Date as the device's local calendar day", () => {
    // new Date(y, monthIndex, d, h) is local time, so this is 23:30 on 5 March wherever the test runs.
    expect(localDateString(new Date(2026, 2, 5, 23, 30))).toBe('2026-03-05');
  });
});

describe('formatWorkoutDate', () => {
  it('shows weekday, month and day', () => {
    expect(formatWorkoutDate('2026-10-12')).toBe('Mon, Oct 12');
    expect(formatWorkoutDate('2026-10-18')).toBe('Sun, Oct 18');
  });
});

describe('groupByWeek', () => {
  const TODAY = '2026-10-14'; // a Wednesday

  it('returns no sections for no workouts', () => {
    expect(groupByWeek([], TODAY)).toEqual([]);
  });

  it('groups by Monday-based week, newest week first, keeping the order within a week', () => {
    const sections = groupByWeek(
      [
        w(5, '2026-10-14'),
        w(4, '2026-10-12'), // Monday: this week
        w(3, '2026-10-11'), // Sunday: last week
        w(2, '2026-10-05'), // Monday: last week
        w(1, '2026-09-30'),
      ],
      TODAY
    );

    expect(sections).toEqual([
      { title: 'This week', weekStart: '2026-10-12', data: [w(5, '2026-10-14'), w(4, '2026-10-12')] },
      { title: 'Last week', weekStart: '2026-10-05', data: [w(3, '2026-10-11'), w(2, '2026-10-05')] },
      { title: 'Sep 28 – Oct 4', weekStart: '2026-09-28', data: [w(1, '2026-09-30')] },
    ]);
  });

  it('sorts weeks newest first even if the input is not sorted', () => {
    const sections = groupByWeek([w(1, '2026-09-30'), w(2, '2026-10-13')], TODAY);

    expect(sections.map((s) => s.weekStart)).toEqual(['2026-10-12', '2026-09-28']);
  });

  it('labels "This week" from Monday through Sunday', () => {
    // Today is Sunday: Monday's workout is still this week.
    expect(groupByWeek([w(1, '2026-10-12')], '2026-10-18')[0]?.title).toBe('This week');
    // Today is Monday: yesterday (Sunday) was last week.
    expect(groupByWeek([w(1, '2026-10-11')], '2026-10-12')[0]?.title).toBe('Last week');
  });

  it('skips empty weeks without inventing sections for them', () => {
    const sections = groupByWeek([w(2, '2026-10-13'), w(1, '2026-08-04')], TODAY);

    expect(sections.map((s) => s.title)).toEqual(['This week', 'Aug 3 – Aug 9']);
  });

  it('handles a week that spans New Year', () => {
    // Today: Thursday 1 Jan 2026, in the week Mon 29 Dec 2025 – Sun 4 Jan 2026.
    const sections = groupByWeek([w(2, '2026-01-01'), w(1, '2025-12-29')], '2026-01-01');

    expect(sections).toEqual([
      { title: 'This week', weekStart: '2025-12-29', data: [w(2, '2026-01-01'), w(1, '2025-12-29')] },
    ]);
  });

  it("adds the year to dates outside today's year", () => {
    const today = '2026-02-11';
    const sections = groupByWeek(
      [w(3, '2026-01-14'), w(2, '2025-12-31'), w(1, '2025-10-07')],
      today
    );

    expect(sections.map((s) => s.title)).toEqual([
      'Jan 12 – Jan 18',
      'Dec 29, 2025 – Jan 4', // spans the new year: only the 2025 end gets a year
      'Oct 6, 2025 – Oct 12, 2025',
    ]);
  });

  it('labels a future week (a mistyped date) with its range', () => {
    expect(groupByWeek([w(1, '2026-10-20')], TODAY)[0]?.title).toBe('Oct 19 – Oct 25');
  });
});

// The classic date bug: new Date('2026-10-12') is midnight UTC, which is still Sunday 11 October
// west of UTC. jest.global-setup.js runs every test in America/Los_Angeles so that this bug shows.
describe('time zones', () => {
  it('runs in a zone west of UTC (otherwise the tests above could pass by luck)', () => {
    expect(new Date('2026-10-12T00:00:00Z').getDate()).toBe(11);
  });

  it('treats dates as plain calendar days, not UTC instants', () => {
    expect(startOfWeek('2026-10-12')).toBe('2026-10-12');
    expect(addDays('2026-10-12', -1)).toBe('2026-10-11');
    expect(formatWorkoutDate('2026-10-12')).toBe('Mon, Oct 12');
    expect(groupByWeek([w(1, '2026-10-12')], '2026-10-14')).toEqual([
      { title: 'This week', weekStart: '2026-10-12', data: [w(1, '2026-10-12')] },
    ]);
  });
});
