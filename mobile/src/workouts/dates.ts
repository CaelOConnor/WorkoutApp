// Calendar-date helpers for 'YYYY-MM-DD' strings, the format the API uses for workout dates.
//
// A workout date is a day on the calendar, not an instant in time, so it must never shift with the
// phone's time zone. `new Date('2026-10-12')` is midnight UTC, which local getters like getDate()
// report as 11 October anywhere west of London. So these helpers never use local getters on parsed
// dates: they turn a date into a whole day number, do integer arithmetic, and format back with
// the UTC getters (UTC has no offset and no daylight saving, so a day is always 86 400 000 ms).

const MS_PER_DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Days since 1970-01-01. The API guard (isDateString) has already checked the format.
function toDayNumber(date: string): number {
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
  return toDateString(fromDayNumber(toDayNumber(date) + days));
}

// The Monday on or before `date`. getUTCDay() counts from Sunday (0), so shift it to count from
// Monday: Monday -> 0, ..., Sunday -> 6.
export function startOfWeek(date: string): string {
  const daysSinceMonday = (fromDayNumber(toDayNumber(date)).getUTCDay() + 6) % 7;
  return addDays(date, -daysSinceMonday);
}

// Today on the phone's own calendar. This is the one place local time is right: "today" is
// whatever day it is where the user is.
export function localDateString(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// 'Mon, Oct 12'. Month names are spelled out here rather than with toLocaleDateString, which
// depends on the JS engine's Intl data and so can differ between Hermes, Node and devices.
export function formatWorkoutDate(date: string): string {
  const d = fromDayNumber(toDayNumber(date));
  return `${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// 'Wed, Oct 14, 2026', for a heading where the year should always show.
export function formatFullDate(date: string): string {
  return `${formatWorkoutDate(date)}, ${date.slice(0, 4)}`;
}

// True for 'YYYY-MM-DD' naming a real day, the same rule as the backend's isDateString: a round
// trip through a UTC date comes back unchanged only if the day exists ('2026-02-30' rolls over
// to March 2). Postgres has no year 0, so '0000-...' is out too.
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) {
    return false;
  }
  const dayNumber = toDayNumber(value);
  return !Number.isNaN(dayNumber) && toDateString(fromDayNumber(dayNumber)) === value;
}

// 'Oct 5', or 'Oct 5, 2025' when it isn't in `currentYear`.
function formatShortDate(date: string, currentYear: number): string {
  const d = fromDayNumber(toDayNumber(date));
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

// Groups workouts into Monday-to-Sunday weeks, newest week first. Workouts keep their input order
// within a week (the API sends newest first). Weeks with no workouts are left out.
//
// Generic over T: anything with a `date` works, so the screen passes WorkoutDetail and gets
// WeekSection<WorkoutDetail> back, while tests can pass plain { id, date } objects.
// `today` is a parameter rather than read from the clock, which keeps the function pure: the same
// input always gives the same output, so tests don't depend on when they run.
export function groupByWeek<T extends { date: string }>(
  workouts: readonly T[],
  today: string
): WeekSection<T>[] {
  // A Map keeps insertion order and is keyed by the week's Monday.
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
