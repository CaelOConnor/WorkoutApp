// A workout date is a calendar day and must never shift with time zone. new Date('2026-10-12') is
// midnight UTC, which is 11 October west of London, so these work in day numbers and UTC getters.

const MS_PER_DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Days since 1970-01-01. Also the chart's x axis, so gaps between days show at their real size.
export function dayNumber(date: string): number {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

function fromDayNumber(dayNumber: number): Date {
  return new Date(dayNumber * MS_PER_DAY);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toDateString(utcDate: Date): string {
  return `${utcDate.getUTCFullYear()}-${pad(utcDate.getUTCMonth() + 1)}-${pad(utcDate.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  return toDateString(fromDayNumber(dayNumber(date) + days));
}

// Whole months later (or earlier, for a negative count), keeping the day of the month. A day the
// target month doesn't have becomes its last day: 31 August minus 6 months is 28 February.
export function addMonths(date: string, months: number): string {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  // Date.UTC rolls a month past 12 into the next year, so no special cases. Day 0 of the next
  // month is the last day of this one.
  const first = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(day, lastDay));
  return toDateString(first);
}

// The inverse of dayNumber.
export function dateOfDayNumber(n: number): string {
  return toDateString(fromDayNumber(n));
}

// The Monday on or before `date`. getUTCDay() counts from Sunday, so shift it to start on Monday.
export function startOfWeek(date: string): string {
  const daysSinceMonday = (fromDayNumber(dayNumber(date)).getUTCDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

// Today on the phone's own calendar. This is the one place local time is right: "today" is
// whatever day it is where the user is.
export function localDateString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// For a native date picker, which works in local time. Noon, not midnight, because midnight can
// be skipped or repeated on a daylight-saving day.
export function localNoon(date: string): Date {
  const [year = NaN, month = NaN, day = NaN] = date.split('-').map(Number);
  return new Date(year, month - 1, day, 12);
}

// 'Mon, Oct 12'. Spelled out by hand because toLocaleDateString differs between JS engines.
export function formatWorkoutDate(date: string): string {
  const d = fromDayNumber(dayNumber(date));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// 'Wed, Oct 14, 2026', for a heading where the year should always show.
export function formatFullDate(date: string): string {
  return `${formatWorkoutDate(date)}, ${date.slice(0, 4)}`;
}

// Same rule as the backend's isDateString: only a real day survives a round trip through a UTC
// date ('2026-02-30' becomes March 2). Postgres has no year 0.
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    return false;
  }
  const days = dayNumber(value);
  return !Number.isNaN(days) && toDateString(fromDayNumber(days)) === value;
}

// 'Oct 5', or 'Oct 5, 2025' when it isn't in `currentYear`.
export function formatShortDate(date: string, currentYear: number): string {
  const d = fromDayNumber(dayNumber(date));
  const year = d.getUTCFullYear();
  const text = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  return year === currentYear ? text : `${text}, ${year}`;
}

// The shape SectionList expects: `data` for the rows, plus anything else for the header.
export interface WeekSection<T> {
  title: string; // 'This week', 'Last week', or 'Oct 5 – Oct 11'
  weekStart: string; // the Monday, 'YYYY-MM-DD'; unique, so it doubles as a React key
  data: T[];
}

// Monday-to-Sunday weeks, newest first. `today` is a parameter, not the clock, so the result
// doesn't depend on when it runs.
export function groupByWeek<T extends { date: string }>(
  workouts: readonly T[],
  today: string
): WeekSection<T>[] {
  const weeks = new Map<string, T[]>();
  for (const workout of workouts) {
    const weekStart = startOfWeek(workout.date);
    const week = weeks.get(weekStart);
    if (week) {
      week.push(workout);
    } else {
      weeks.set(weekStart, [workout]);
    }
  }

  const thisWeek = startOfWeek(today);
  const lastWeek = addDays(thisWeek, -7);
  const currentYear = Number(today.slice(0, 4));

  function label(weekStart: string): string {
    if (weekStart === thisWeek) return 'This week';
    if (weekStart === lastWeek) return 'Last week';
    const sunday = addDays(weekStart, 6);
    return `${formatShortDate(weekStart, currentYear)} – ${formatShortDate(sunday, currentYear)}`;
  }

  return (
    [...weeks]
      // 'YYYY-MM-DD' strings sort the same way as the dates they stand for, so compare as strings.
      .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
      .map(([weekStart, data]) => ({ title: label(weekStart), weekStart, data }))
  );
}
