// Runtime type guards for API responses, in the style of backend/src/validation.ts.
//
// `response.json()` returns `any`: TypeScript can't know what the server sent. These guards check
// the shape at runtime and return `value is X` (a type predicate), so after a guard returns true
// the value is narrowed from `unknown` to `X`. A server bug or version mismatch then fails loudly
// in one place instead of as `undefined` deep inside a screen.
//
// Unlike the backend's request guards, these allow extra keys: a newer server adding a field
// shouldn't break an older app.

import type {
  CreateWorkoutResponse,
  ErrorResponse,
  Exercise,
  ExerciseProgress,
  LoggedExercise,
  LoginResponse,
  ProgressPoint,
  PublicUser,
  WeightUnit,
  WorkoutDetail,
  WorkoutDetailSet,
} from '@shared/models';

// ---------- Building blocks ----------

// unknown -> Record<string, unknown>. typeof null and typeof [] are both 'object', so rule them out.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Ids come from SERIAL columns, which start at 1.
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// `T | null` columns. Missing (undefined) is not the same as null: the server always sends the key.
function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPositiveIntegerOrNull(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

// sets.weight is NUMERIC(6,2); the backend parses it to a number (db/pool.ts), e.g. 135 or 132.5.
// typeof NaN and typeof Infinity are both 'number', so Number.isFinite does the real check.
function isWeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isWeightUnit(value: unknown): value is WeightUnit {
  return value === 'lb' || value === 'kg';
}

// DATE columns arrive as 'YYYY-MM-DD' (backend db/pool.ts). The server is trusted to send a real
// calendar day; this only catches a format change, such as a full ISO timestamp.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_PATTERN.test(value);
}

// A guard for a list, built from a guard for one item. The generic <T> carries the item type
// through, so isListOf(isExercise) is itself a guard for Exercise[].
// Array.isArray narrows to any[]; .every(guard) checks each element, so no `any` escapes.
function isListOf<T>(guard: (item: unknown) => item is T) {
  return (value: unknown): value is T[] => Array.isArray(value) && value.every(guard);
}

// ---------- Responses ----------

// POST /auth/login
export function isLoginResponse(value: unknown): value is LoginResponse {
  return isRecord(value) && isNonEmptyString(value.token) && typeof value.email === 'string';
}

// POST /auth/signup
export function isPublicUser(value: unknown): value is PublicUser {
  return isRecord(value) && isPositiveInteger(value.id) && typeof value.email === 'string';
}

function isExercise(value: unknown): value is Exercise {
  return (
    isRecord(value) &&
    isPositiveInteger(value.id) &&
    typeof value.name === 'string' &&
    isStringOrNull(value.muscle_group) &&
    isPositiveIntegerOrNull(value.created_by)
  );
}

// GET /exercises
export const isExerciseList = isListOf(isExercise);

function isWorkoutDetailSet(value: unknown): value is WorkoutDetailSet {
  return (
    isRecord(value) &&
    isPositiveInteger(value.id) &&
    isPositiveInteger(value.exercise_id) &&
    isPositiveInteger(value.set_number) &&
    isNonNegativeInteger(value.reps) &&
    isWeight(value.weight) &&
    isWeightUnit(value.unit) &&
    typeof value.exercise_name === 'string'
  );
}

// GET/PATCH /workouts/:id, POST /workouts/:id/sets, PATCH /workouts/:id/sets/:setId
export function isWorkoutDetail(value: unknown): value is WorkoutDetail {
  return (
    isRecord(value) &&
    isPositiveInteger(value.id) &&
    isDateString(value.date) &&
    isStringOrNull(value.notes) &&
    Array.isArray(value.sets) &&
    value.sets.every(isWorkoutDetailSet)
  );
}

// GET /workouts
export const isWorkoutDetailList = isListOf(isWorkoutDetail);

// Progress numbers are rounded weights (or sums of them): finite and never negative, like a weight.
function isProgressPoint(value: unknown): value is ProgressPoint {
  return (
    isRecord(value) &&
    isDateString(value.date) &&
    isWeight(value.top_weight) &&
    isWeight(value.e1rm) &&
    isWeight(value.volume) &&
    // A point only exists for a day with at least one counted set.
    isPositiveInteger(value.sets)
  );
}

// GET /exercises/:id/progress
export function isExerciseProgress(value: unknown): value is ExerciseProgress {
  return (
    isRecord(value) &&
    isPositiveInteger(value.exercise_id) &&
    typeof value.exercise_name === 'string' &&
    isWeightUnit(value.unit) &&
    Array.isArray(value.points) &&
    value.points.every(isProgressPoint)
  );
}

function isLoggedExercise(value: unknown): value is LoggedExercise {
  return (
    isRecord(value) &&
    isPositiveInteger(value.id) &&
    typeof value.name === 'string' &&
    isDateString(value.last_date) &&
    isWeightUnit(value.unit)
  );
}

// GET /exercises/logged
export const isLoggedExerciseList = isListOf(isLoggedExercise);

// POST /workouts (201): just the new workout's id.
export function isCreateWorkoutResponse(value: unknown): value is CreateWorkoutResponse {
  return isRecord(value) && isPositiveInteger(value.id);
}

// The body of every 4xx/5xx the API itself sends.
export function isErrorResponse(value: unknown): value is ErrorResponse {
  return isRecord(value) && typeof value.error === 'string';
}

// DELETE responses are 204 with no body; the client passes `undefined` for those.
export function isNoContent(value: unknown): value is undefined {
  return value === undefined;
}
