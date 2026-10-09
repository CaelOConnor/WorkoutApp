// Runtime type guards for request bodies, plus parseId for URL params.
//
// TypeScript types disappear when the code is compiled, so nothing checks that a client
// actually sent a CreateWorkoutBody. These functions do that check at runtime.
// Each one returns `value is X` (a "type predicate"): when it returns true, TypeScript
// narrows the argument from `unknown` to `X` in the calling code.

import type {
  AuthBody,
  CreateWorkoutBody,
  NewSetInput,
  TokenPayload,
  UpdateSetBody,
  UpdateWorkoutBody,
  WeightUnit,
} from './types/models';

// unknown -> Record<string, unknown>
// `typeof x === 'object'` is also true for null and arrays, so both are ruled out explicitly.
// After this, reading value.anything is allowed, but each property is still `unknown`.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// unknown -> string (non-empty)
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Largest value a Postgres INTEGER (and so a SERIAL id) can hold.
const MAX_PG_INTEGER = 2_147_483_647;

// unknown -> number. `typeof` narrows to number first, so `value > 0` type-checks.
// Every integer we accept ends up in an INTEGER column, so anything larger would make Postgres
// throw an out-of-range error (a 500) instead of us returning a 400.
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PG_INTEGER;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PG_INTEGER;
}

// sets.weight is NUMERIC(6,2): at most 6 digits, 2 of them after the point.
const MAX_WEIGHT = 9999.99;

// Digits, then optionally a point and one or two more. No sign, exponent or third decimal.
const WEIGHT_PATTERN = /^\d+(\.\d{1,2})?$/;

// unknown -> number that sets.weight stores exactly.
// Too large overflows the column (a 500). Too many decimals is worse: Postgres silently rounds
// (100.125 is stored as 100.13), so the client would get back a weight it never sent.
// String(value) is the text pg sends to Postgres, so checking it checks exactly what gets stored.
// It's also the shortest text that reads back as the same number, so 100.12 is "100.12" even
// though the float isn't exactly 100.12; arithmetic like value * 100 would expose that error.
// Number.isFinite rules out NaN and Infinity, which are still typeof 'number'.
function isSetWeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_WEIGHT &&
    WEIGHT_PATTERN.test(String(value))
  );
}

// unknown -> 'lb' | 'kg'. Comparing against each literal narrows to that literal.
function isWeightUnit(value: unknown): value is WeightUnit {
  return value === 'lb' || value === 'kg';
}

// Exactly YYYY-MM-DD: ^ and $ anchor both ends, so nothing may come before or after.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// unknown -> string in YYYY-MM-DD form that names a real calendar day.
// Date.parse alone isn't enough: it reads many formats ('10/07/2026', timestamps), and it rolls
// impossible days over ('2026-02-30' becomes March 2) instead of rejecting them.
function isDateString(value: unknown): value is string {
  // Year 0000 fits the pattern and JS accepts it, but Postgres has no year 0 (1 BC is
  // followed directly by AD 1).
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || value.startsWith('0000')) {
    return false;
  }
  // Calendar check by round trip: parse as UTC midnight, then format back to YYYY-MM-DD.
  // A real day comes back unchanged; an impossible one has rolled over and comes back different.
  // The 'Z' (UTC) stops the local time zone from shifting the result onto another day.
  const date = new Date(`${value}T00:00:00Z`);
  // Some impossible values (month 13, day 00) give an Invalid Date instead of rolling over,
  // and toISOString() throws on those, so check first.
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// unknown -> NewSetInput
// isRecord narrows first, so value.exercise_id etc. can be read (each is `unknown`),
// then every field is checked. Optional `unit` may be missing (undefined) or a valid unit.
export function isNewSetInput(value: unknown): value is NewSetInput {
  return (
    isRecord(value) &&
    isPositiveInteger(value.exercise_id) &&
    isPositiveInteger(value.set_number) &&
    isNonNegativeInteger(value.reps) &&
    isSetWeight(value.weight) &&
    (value.unit === undefined || isWeightUnit(value.unit))
  );
}

// unknown -> CreateWorkoutBody
// Array.isArray narrows `unknown` to `any[]`, a gap where `any` sneaks in.
// We only use it to call .every(isNewSetInput), which checks each element, so no `any` escapes.
export function isCreateWorkoutBody(value: unknown): value is CreateWorkoutBody {
  return (
    isRecord(value) &&
    (value.date === undefined || isDateString(value.date)) &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    Array.isArray(value.sets) &&
    value.sets.every(isNewSetInput)
  );
}

const UPDATE_WORKOUT_KEYS = ['date', 'notes'];

// unknown -> UpdateWorkoutBody
// A missing key reads as undefined, which is allowed for each field, but at least one must be
// present: an empty update has nothing to change (and would build an empty SET clause).
// Unlike the POST guard, extra keys are rejected, so a typo or a field like user_id can't be
// silently ignored.
export function isUpdateWorkoutBody(value: unknown): value is UpdateWorkoutBody {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => UPDATE_WORKOUT_KEYS.includes(key)) &&
    (value.date !== undefined || value.notes !== undefined) &&
    (value.date === undefined || isDateString(value.date)) &&
    (value.notes === undefined || value.notes === null || typeof value.notes === 'string')
  );
}

// The columns PATCH /workouts/:id/sets/:setId may change. Exported so the route builds its SET
// clause from the same list the guard allows.
// `as const` keeps each entry as its literal type ('reps', not string), and `satisfies` checks
// every entry is a real key of UpdateSetBody without widening it back to that type.
export const UPDATE_SET_KEYS = [
  'exercise_id',
  'set_number',
  'reps',
  'weight',
  'unit',
] as const satisfies readonly (keyof UpdateSetBody)[];

// unknown -> UpdateSetBody
// Same rules as isUpdateWorkoutBody: no unknown keys (so workout_id or id can't look editable),
// at least one field, and each field that's present must be valid. Every set column is NOT NULL,
// so null fails each check below rather than having a case of its own.
export function isUpdateSetBody(value: unknown): value is UpdateSetBody {
  if (!isRecord(value)) {
    return false;
  }
  // A readonly tuple of literals is assignable to readonly string[], so this widens it without a
  // cast. includes() on the literal tuple itself wouldn't accept an arbitrary string key.
  const allowedKeys: readonly string[] = UPDATE_SET_KEYS;
  return (
    Object.keys(value).every((key) => allowedKeys.includes(key)) &&
    UPDATE_SET_KEYS.some((key) => value[key] !== undefined) &&
    (value.exercise_id === undefined || isPositiveInteger(value.exercise_id)) &&
    (value.set_number === undefined || isPositiveInteger(value.set_number)) &&
    (value.reps === undefined || isNonNegativeInteger(value.reps)) &&
    (value.weight === undefined || isSetWeight(value.weight)) &&
    (value.unit === undefined || isWeightUnit(value.unit))
  );
}

// unknown -> AuthBody
export function isAuthBody(value: unknown): value is AuthBody {
  return isRecord(value) && isNonEmptyString(value.email) && isNonEmptyString(value.password);
}

// string -> number | null, for ids in URL params like /workouts/:id.
// Route params are always strings, so this converts as well as checks. That's why it returns
// the number (or null) instead of being a `value is X` guard: a guard can only narrow the
// type of the value it was given, not hand back a different value.
// The regex allows only digits with no leading zero, which rules out '', '0', '-1', '1.5',
// '1e3' and ' 7', all of which Number() would otherwise turn into some number or other.
export function parseId(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return id <= MAX_PG_INTEGER ? id : null;
}

// unknown -> TokenPayload
// jwt.verify returns `string | JwtPayload`, and JwtPayload allows any extra keys, so it says
// nothing about userId. A valid signature only proves we signed it, so still check the shape.
export function isTokenPayload(value: unknown): value is TokenPayload {
  return isRecord(value) && isPositiveInteger(value.userId);
}
