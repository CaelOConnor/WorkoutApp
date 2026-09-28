// Runtime type guards for request bodies.
//
// TypeScript types disappear when the code is compiled, so nothing checks that a client
// actually sent a CreateWorkoutBody. These functions do that check at runtime.
// Each one returns `value is X` (a "type predicate"): when it returns true, TypeScript
// narrows the argument from `unknown` to `X` in the calling code.

import type { AuthBody, CreateWorkoutBody, NewSetInput, WeightUnit } from './types/models';

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

// unknown -> number. `typeof` narrows to number first, so `value > 0` type-checks.
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

// Number.isFinite rules out NaN and Infinity, which are still typeof 'number'.
function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// unknown -> 'lb' | 'kg'. Comparing against each literal narrows to that literal.
function isWeightUnit(value: unknown): value is WeightUnit {
  return value === 'lb' || value === 'kg';
}

// A valid date string: Date.parse returns NaN for strings it can't read.
function isDateString(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
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
    isNonNegativeNumber(value.weight) &&
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

// unknown -> AuthBody
export function isAuthBody(value: unknown): value is AuthBody {
  return isRecord(value) && isNonEmptyString(value.email) && isNonEmptyString(value.password);
}
