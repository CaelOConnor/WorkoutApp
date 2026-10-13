// Form state for the detail screen's sheets, and turning it into request bodies.
//
// Text inputs hold strings, so a form keeps its values as text while the user types and only
// converts them on Save. The parse functions check the same rules as the backend's validators,
// so the user gets a clear message here instead of a generic 400.
import type {
  AddSetBody,
  UpdateWorkoutBody,
  WeightUnit,
  WorkoutDetail,
  WorkoutDetailSet,
} from '@shared/models';

import { isCalendarDate } from './dates';
import { formatWeight } from './detail';

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

export function setFormFrom(set: WorkoutDetailSet): SetForm {
  return { reps: String(set.reps), weight: formatWeight(set.weight), unit: set.unit };
}

export function parseSetForm(form: SetForm): FormResult<SetValues> {
  const repsText = form.reps.trim();
  const reps = Number(repsText);
  if (!/^\d+$/.test(repsText) || reps > MAX_REPS) {
    return { ok: false, error: 'Reps must be a whole number.' };
  }
  // Some keyboards (e.g. in Europe) type a comma as the decimal point.
  const weightText = form.weight.trim().replace(',', '.');
  const weight = Number(weightText);
  if (!WEIGHT_PATTERN.test(weightText) || weight > MAX_WEIGHT) {
    return { ok: false, error: 'Weight must be a number up to 9999.99, with at most 2 decimals.' };
  }
  return { ok: true, value: { reps, weight, unit: form.unit } };
}

// "+ Add set" repeats the exercise's last set, which is usually what comes next; the user edits
// it if not. No set_number: the server uses the workout's highest + 1.
export function addSetBodyFrom(lastSet: WorkoutDetailSet): AddSetBody {
  return {
    exercise_id: lastSet.exercise_id,
    reps: lastSet.reps,
    weight: Number(lastSet.weight),
    unit: lastSet.unit,
  };
}

// ---------- Workout date and notes ----------

export interface WorkoutForm {
  date: string;
  notes: string;
}

export function workoutFormFrom(workout: Pick<WorkoutDetail, 'date' | 'notes'>): WorkoutForm {
  return { date: workout.date, notes: workout.notes ?? '' };
}

// Both fields are always sent. Empty notes become null, which clears them (see UpdateWorkoutBody).
export function parseWorkoutForm(form: WorkoutForm): FormResult<UpdateWorkoutBody> {
  const date = form.date.trim();
  if (!isCalendarDate(date)) {
    return { ok: false, error: 'Enter a real date as YYYY-MM-DD.' };
  }
  const notes = form.notes.trim();
  return { ok: true, value: { date, notes: notes === '' ? null : notes } };
}
