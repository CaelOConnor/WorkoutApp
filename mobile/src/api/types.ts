// Guards for API responses, like backend/src/validation.ts but for what the server sends back.
// A server bug or version mismatch fails here, in one place, instead of deep inside a screen.
// Unlike the server's guards, extra keys are allowed: a newer server adding a field
// shouldn't break an older app.

import type {
  CreateWorkoutResponse,
  ErrorResponse,
  Exercise,
  ExerciseLastSets,
  ExerciseProgress,
  LoggedExercise,
  LoginResponse,
  ProgressPoint,
  PublicUser,
  TemplateDetail,
  TemplateDetailExercise,
  WeightUnit,
  WorkoutDetail,
  WorkoutDetailSet,
} from '@shared/models';

// ---------- Building blocks ----------

// typeof null and arrays are also 'object', so both are ruled out.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// The server always sends these keys, so missing is not the same as null.
function isStringOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isPositiveIntegerOrNull(value: unknown): value is number | null {
  return value === null || isPositiveInteger(value);
}

// Number.isFinite rules out NaN and Infinity, which are still numbers.
function isWeight(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isWeightUnit(value: unknown): value is WeightUnit {
  return value === 'lb' || value === 'kg';
}

// Only checks the format. The server already makes sure it's a real day.
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isDateString(value: unknown): value is string {
  return typeof value === 'string' && DATE_PATTERN.test(value);
}

// Turns a guard for one item into a guard for a list of them.
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

// POST /exercises
export function isExercise(value: unknown): value is Exercise {
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

// GET and PATCH /workouts/:id, and the set routes
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

function isProgressPoint(value: unknown): value is ProgressPoint {
  return (
    isRecord(value) &&
    isDateString(value.date) &&
    isWeight(value.top_weight) &&
    isWeight(value.volume) &&
    isPositiveInteger(value.sets) // a point only exists for a day with at least one set
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

function isTemplateDetailExercise(value: unknown): value is TemplateDetailExercise {
  return (
    isRecord(value) &&
    isPositiveInteger(value.exercise_id) &&
    typeof value.exercise_name === 'string' &&
    isPositiveInteger(value.set_count)
  );
}

// POST /templates, GET and PUT /templates/:id
export function isTemplateDetail(value: unknown): value is TemplateDetail {
  return (
    isRecord(value) &&
    isPositiveInteger(value.id) &&
    isNonEmptyString(value.name) &&
    Array.isArray(value.exercises) &&
    value.exercises.length > 0 && // the server requires at least one exercise
    value.exercises.every(isTemplateDetailExercise)
  );
}

// GET /templates
export const isTemplateDetailList = isListOf(isTemplateDetail);

// One of last time's sets. Only sets with 1+ reps are sent.
function isLastSet(value: unknown): value is ExerciseLastSets['sets'][number] {
  return (
    isRecord(value) &&
    isPositiveInteger(value.reps) &&
    isWeight(value.weight) &&
    isWeightUnit(value.unit)
  );
}

function isExerciseLastSets(value: unknown): value is ExerciseLastSets {
  return (
    isRecord(value) &&
    isPositiveInteger(value.exercise_id) &&
    isDateString(value.date) &&
    Array.isArray(value.sets) &&
    value.sets.length > 0 && // exercises with no sets are left out by the server
    value.sets.every(isLastSet)
  );
}

// GET /exercises/last-sets
export const isExerciseLastSetsList = isListOf(isExerciseLastSets);

// POST /workouts: just the new workout's id.
export function isCreateWorkoutResponse(value: unknown): value is CreateWorkoutResponse {
  return isRecord(value) && isPositiveInteger(value.id);
}

// The body of every error the server sends.
export function isErrorResponse(value: unknown): value is ErrorResponse {
  return isRecord(value) && typeof value.error === 'string';
}

// For DELETE: a 204 has no body, which the client turns into undefined.
export function isNoContent(value: unknown): value is undefined {
  return value === undefined;
}