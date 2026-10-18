// Form state for the detail screen's sheets, and turning it into request bodies.
//
// Text inputs hold strings, so a form keeps its values as text while the user types and only
// converts them on Save. The parse functions check the same rules as the backend's validators,
// so the user gets a clear message here instead of a generic 400.
import type {
  AddSetBody,
  ExerciseLastSets,
  UpdateWorkoutBody,
  WeightUnit,
  WorkoutDetail,
  WorkoutDetailSet,
} from '@shared/models';

import { isCalendarDate } from './dates';

// The result of parsing a form: the body to send, or a message to show. A discriminated union,
// like ParsedBody in api/client.ts: checking `ok` tells TypeScript which fields exist.
export type FormResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------- Sets ----------

export interface SetForm {
  reps: string;
  weight: string;
  unit: WeightUnit;
}

// The PATCH body the set sheet sends: every editable field, as numbers. Required<Pick<...>> would
// also work, but spelling it out reads more clearly.
export interface SetValues {
  reps: number;
  weight: number;
  unit: WeightUnit;
}

const MAX_REPS = 2_147_483_647; // Postgres INTEGER
const MAX_WEIGHT = 9999.99; // NUMERIC(6,2)
// Digits, then optionally a point and one or two more: what NUMERIC(6,2) stores exactly.
const WEIGHT_PATTERN = /^\d+(\.\d{1,2})?$/;

// A number prints in its shortest form, so String(132.5) is '132.5' and String(225) is '225'.
export function setFormFrom(set: WorkoutDetailSet): SetForm {
  return { reps: String(set.reps), weight: String(set.weight), unit: set.unit };
}

const REPS_ERROR = 'Reps must be a whole number.';
const WEIGHT_ERROR = 'Weight must be a number up to 9999.99, with at most 2 decimals.';

// Text -> number, or null if the text isn't valid. Kept private: callers use the error or parse
// functions below, so the rule and its message can't drift apart.
function parseReps(text: string): number | null {
  const trimmed = text.trim();
  const reps = Number(trimmed);
  return /^\d+$/.test(trimmed) && reps <= MAX_REPS ? reps : null;
}

function parseWeight(text: string): number | null {
  // Some keyboards (e.g. in Europe) type a comma as the decimal point.
  const normalized = text.trim().replace(',', '.');
  const weight = Number(normalized);
  return WEIGHT_PATTERN.test(normalized) && weight <= MAX_WEIGHT ? weight : null;
}

// One field's error message, or null if it's valid: for showing next to that field.
export function repsError(text: string): string | null {
  return parseReps(text) === null ? REPS_ERROR : null;
}

export function weightError(text: string): string | null {
  return parseWeight(text) === null ? WEIGHT_ERROR : null;
}

export function parseSetForm(form: SetForm): FormResult<SetValues> {
  const reps = parseReps(form.reps);
  if (reps === null) {
    return { ok: false, error: REPS_ERROR };
  }
  const weight = parseWeight(form.weight);
  if (weight === null) {
    return { ok: false, error: WEIGHT_ERROR };
  }
  return { ok: true, value: { reps, weight, unit: form.unit } };
}

// "+ Add set" repeats the exercise's last set, which is usually what comes next; the user edits
// it if not. No set_number: the server makes it the exercise's last set (its highest + 1).
export function addSetBodyFrom(lastSet: WorkoutDetailSet): AddSetBody {
  return {
    exercise_id: lastSet.exercise_id,
    reps: lastSet.reps,
    weight: lastSet.weight,
    unit: lastSet.unit,
  };
}

// The first set of an exercise newly added to a saved workout, saved straight away so the set
// sheet can open on it: last time's first set (GET /exercises/last-sets), which the user edits
// if today differs. For an exercise never logged, a placeholder at 0 reps × 0 (valid for both
// fields, and it stands out if left) in the workout's last unit (lb if it has no sets).
export function firstSetBody(
  exerciseId: number,
  workoutSets: readonly WorkoutDetailSet[],
  lastTime: ExerciseLastSets['sets']
): AddSetBody {
  const first = lastTime[0];
  if (first) {
    return { exercise_id: exerciseId, reps: first.reps, weight: first.weight, unit: first.unit };
  }
  return { exercise_id: exerciseId, reps: 0, weight: 0, unit: workoutSets.at(-1)?.unit ?? 'lb' };
}

// ---------- Workout date and notes ----------

export interface WorkoutForm {
  date: string;
  notes: string;
}

export function workoutFormFrom(workout: Pick<WorkoutDetail, 'date' | 'notes'>): WorkoutForm {
  return { date: workout.date, notes: workout.notes ?? '' };
}

export const DATE_ERROR = 'Enter a real date as YYYY-MM-DD.';

// Both fields are always sent. Empty notes become null, which clears them (see UpdateWorkoutBody).
export function parseWorkoutForm(form: WorkoutForm): FormResult<UpdateWorkoutBody> {
  const date = form.date.trim();
  if (!isCalendarDate(date)) {
    return { ok: false, error: DATE_ERROR };
  }
  const notes = form.notes.trim();
  return { ok: true, value: { date, notes: notes === '' ? null : notes } };
}
