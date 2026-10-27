// Type guards: check at runtime that request data really has the shape its type claims.
// Types are gone at runtime, so these are the only real check on what a client sends.
// A `value is X` return type tells TypeScript the value is an X wherever the guard returned true.

import type {
  AuthBody,
  CreateExerciseBody,
  CreateWorkoutBody,
  NewSetInput,
  ProgressQuery,
  TemplateBody,
  TokenPayload,
  UpdateSetBody,
  UpdateWorkoutBody,
  WeightUnit,
} from './types/models';

// typeof null and arrays are also 'object', so both are ruled out.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Largest value a Postgres INTEGER column can hold. Anything bigger would be a 500, not a 400.
const MAX_PG_INTEGER = 2_147_483_647;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_PG_INTEGER;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= MAX_PG_INTEGER;
}

// Limits of the NUMERIC(6,2) weight column: up to 9999.99, at most 2 decimals.
const MAX_WEIGHT = 9999.99;
const WEIGHT_PATTERN = /^\d+(\.\d{1,2})?$/;

// A third decimal must be rejected, because Postgres would silently round it (100.125 to 100.13).
// Checking String(value) checks the exact text that gets sent to Postgres.
function isSetWeight(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) && // rules out NaN and Infinity, which are still numbers
    value >= 0 &&
    value <= MAX_WEIGHT &&
    WEIGHT_PATTERN.test(String(value))
  );
}

function isWeightUnit(value: unknown): value is WeightUnit {
  return value === 'lb' || value === 'kg';
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Must be exactly YYYY-MM-DD and a real day. Date.parse alone accepts other formats
// and turns impossible days like Feb 30 into March 2.
function isDateString(value: unknown): value is string {
  // Postgres has no year 0.
  if (typeof value !== 'string' || !DATE_PATTERN.test(value) || value.startsWith('0000')) {
    return false;
  }
  // Round trip: a real day comes back unchanged, an impossible one comes back different.
  // The Z (UTC) stops the local time zone from shifting the day.
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// satisfies makes this a compile error if a name here stops being a field of NewSetInput.
const NEW_SET_KEYS = ['exercise_id', 'reps', 'weight', 'unit'] as const satisfies readonly (keyof NewSetInput)[];

// Unknown keys are rejected, so a client can't send set_number or workout_id and think it was used.
export function isNewSetInput(value: unknown): value is NewSetInput {
  if (!isRecord(value)) {
    return false;
  }
  const allowedKeys: readonly string[] = NEW_SET_KEYS;
  return (
    Object.keys(value).every((key) => allowedKeys.includes(key)) &&
    isPositiveInteger(value.exercise_id) &&
    isNonNegativeInteger(value.reps) &&
    isSetWeight(value.weight) &&
    (value.unit === undefined || isWeightUnit(value.unit))
  );
}

export function isCreateWorkoutBody(value: unknown): value is CreateWorkoutBody {
  return (
    isRecord(value) &&
    isDateString(value.date) &&
    (value.notes === undefined || typeof value.notes === 'string') &&
    Array.isArray(value.sets) &&
    value.sets.every(isNewSetInput)
  );
}

const UPDATE_WORKOUT_KEYS = ['date', 'notes'];

// At least one field required: an empty update would build invalid SQL.
// Unknown keys are rejected, so a typo or user_id isn't silently ignored.
export function isUpdateWorkoutBody(value: unknown): value is UpdateWorkoutBody {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => UPDATE_WORKOUT_KEYS.includes(key)) &&
    (value.date !== undefined || value.notes !== undefined) &&
    (value.date === undefined || isDateString(value.date)) &&
    (value.notes === undefined || value.notes === null || typeof value.notes === 'string')
  );
}

// Exported so the PATCH set route builds its SQL from the same list the guard allows.
export const UPDATE_SET_KEYS = ['reps', 'weight', 'unit'] as const satisfies readonly (keyof UpdateSetBody)[];

// Same rules as isUpdateWorkoutBody. Set columns can't be null, so null fails every check.
export function isUpdateSetBody(value: unknown): value is UpdateSetBody {
  if (!isRecord(value)) {
    return false;
  }
  const allowedKeys: readonly string[] = UPDATE_SET_KEYS;
  return (
    Object.keys(value).every((key) => allowedKeys.includes(key)) &&
    UPDATE_SET_KEYS.some((key) => value[key] !== undefined) &&
    (value.reps === undefined || isNonNegativeInteger(value.reps)) &&
    (value.weight === undefined || isSetWeight(value.weight)) &&
    (value.unit === undefined || isWeightUnit(value.unit))
  );
}

const PROGRESS_QUERY_KEYS = ['unit', 'from', 'to'];

// Unknown keys are rejected, so a typo like ?form= is a 400 instead of quietly meaning "all time".
export function isProgressQuery(value: unknown): value is ProgressQuery {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => PROGRESS_QUERY_KEYS.includes(key)) &&
    (value.unit === undefined || isWeightUnit(value.unit)) &&
    (value.from === undefined || isDateString(value.from)) &&
    (value.to === undefined || isDateString(value.to)) &&
    // YYYY-MM-DD strings sort in date order, so comparing them as text compares the days.
    !(typeof value.from === 'string' && typeof value.to === 'string' && value.from > value.to)
  );
}

const MAX_LAST_SETS_IDS = 100;

// Parses ?ids=3,1,2 into [3, 1, 2], or null if any id is invalid.
// Order is kept because the response follows it. Duplicates are removed.
export function parseLastSetsQuery(value: unknown): number[] | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['ids']) || typeof value.ids !== 'string') {
    return null;
  }
  const items = value.ids.split(',');
  if (items.length > MAX_LAST_SETS_IDS) {
    return null;
  }
  const ids: number[] = [];
  for (const item of items) {
    const id = parseId(item);
    if (id === null) {
      return null;
    }
    ids.push(id);
  }
  return [...new Set(ids)]; // removes duplicates, keeps the order
}

// Column limits: exercises.name VARCHAR(100), muscle_group VARCHAR(50).
const MAX_EXERCISE_NAME_LENGTH = 100;
const MAX_MUSCLE_GROUP_LENGTH = 50;

// Counts characters the way Postgres does. .length counts most emoji as 2.
function characterCount(value: string): number {
  return [...value].length;
}

const CREATE_EXERCISE_KEYS = ['name', 'muscle_group'];

// Returns the cleaned-up body (trimmed, blank muscle group as null), or null if invalid.
// Not a guard, because a guard can't return changed values.
export function parseCreateExerciseBody(value: unknown): Required<CreateExerciseBody> | null {
  if (!isRecord(value) || !Object.keys(value).every((key) => CREATE_EXERCISE_KEYS.includes(key))) {
    return null;
  }
  if (typeof value.name !== 'string') {
    return null;
  }
  const name = value.name.trim();
  if (name.length === 0 || characterCount(name) > MAX_EXERCISE_NAME_LENGTH) {
    return null;
  }
  const muscleGroup = value.muscle_group;
  if (muscleGroup === undefined || muscleGroup === null) {
    return { name, muscle_group: null };
  }
  if (typeof muscleGroup !== 'string') {
    return null;
  }
  const trimmedGroup = muscleGroup.trim();
  if (characterCount(trimmedGroup) > MAX_MUSCLE_GROUP_LENGTH) {
    return null;
  }
  // || (not ??) so an empty string also becomes null.
  return { name, muscle_group: trimmedGroup || null };
}

// templates.name is VARCHAR(100); set_count must be 1 to 20.
const MAX_TEMPLATE_NAME_LENGTH = 100;
const MAX_TEMPLATE_SET_COUNT = 20;

export const TEMPLATE_NAME_ERROR = 'Template names must be 1 to 100 characters';
export const INVALID_TEMPLATE_ERROR = 'Invalid template body';

const TEMPLATE_BODY_KEYS = ['name', 'exercises'] as const satisfies readonly (keyof TemplateBody)[];
const TEMPLATE_EXERCISE_KEYS = ['exercise_id', 'set_count'] as const satisfies readonly (keyof TemplateExerciseInput)[];

type TemplateExerciseInput = TemplateBody['exercises'][number];

// Either success with a value, or failure with an error message.
// Checking result.ok tells TypeScript which one it is.
export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isTemplateExerciseInput(value: unknown): value is TemplateExerciseInput {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, TEMPLATE_EXERCISE_KEYS) &&
    isPositiveInteger(value.exercise_id) &&
    isPositiveInteger(value.set_count) &&
    value.set_count <= MAX_TEMPLATE_SET_COUNT
  );
}

// A bad name gets its own message, because the app shows it next to the name field.
// Anything else is built by the app itself, so one generic message is enough.
export function parseTemplateBody(value: unknown): ParseResult<TemplateBody> {
  const invalid = { ok: false, error: INVALID_TEMPLATE_ERROR } as const;
  if (!isRecord(value) || !hasOnlyKeys(value, TEMPLATE_BODY_KEYS)) {
    return invalid;
  }
  const { exercises } = value;
  if (!Array.isArray(exercises) || exercises.length === 0 || !exercises.every(isTemplateExerciseInput)) {
    return invalid;
  }
  // Each exercise at most once. A Set drops duplicates, so a smaller size means there was one.
  if (new Set(exercises.map((e) => e.exercise_id)).size !== exercises.length) {
    return invalid;
  }
  if (typeof value.name !== 'string') {
    return { ok: false, error: TEMPLATE_NAME_ERROR };
  }
  const name = value.name.trim();
  if (name.length === 0 || characterCount(name) > MAX_TEMPLATE_NAME_LENGTH) {
    return { ok: false, error: TEMPLATE_NAME_ERROR };
  }
  // Rebuilt so only the checked fields get through.
  return {
    ok: true,
    value: { name, exercises: exercises.map(({ exercise_id, set_count }) => ({ exercise_id, set_count })) },
  };
}

// Returns the body with the email trimmed and lowercased, or null if invalid. Signup and login
// both use it, so "Cael@Test.com " and "cael@test.com" are the same account.
export function parseAuthBody(value: unknown): AuthBody | null {
  if (!isRecord(value) || typeof value.email !== 'string' || !isNonEmptyString(value.password)) {
    return null;
  }
  const email = value.email.trim().toLowerCase();
  return email.length > 0 ? { email, password: value.password } : null;
}

// Turns a URL id like '42' into 42, or null if it isn't a valid id.
// Only digits with no leading zero, so '', '0', '-1', '1.5' and ' 7' are all rejected.
export function parseId(value: string): number | null {
  if (!/^[1-9][0-9]*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return id <= MAX_PG_INTEGER ? id : null;
}

// A valid signature only proves we signed the token, so still check what's inside.
export function isTokenPayload(value: unknown): value is TokenPayload {
  return isRecord(value) && isPositiveInteger(value.userId);
}