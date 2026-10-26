// Forms keep text while the user types and convert it on Save. The checks match the backend's,
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

// The body to send, or a message to show.
export type FormResult<T> = { ok: true; value: T } | { ok: false; error: string };

// ---------- Sets ----------

export interface SetForm {
  reps: string;
  weight: string;
  unit: WeightUnit;
}

// The PATCH body the set sheet sends.
export interface SetValues {
  reps: number;
  weight: number;
  unit: WeightUnit;
}

const MAX_REPS = 2_147_483_647; // Postgres INTEGER
const MAX_WEIGHT = 9999.99; // NUMERIC(6,2)
// At most 2 decimals, which NUMERIC(6,2) stores exactly.
const WEIGHT_PATTERN = /^\d+(\.\d{1,2})?$/;

export function setFormFrom(set: WorkoutDetailSet): SetForm {
  return { reps: String(set.reps), weight: String(set.weight), unit: set.unit };
}

const REPS_ERROR = 'Reps must be a whole number.';
const WEIGHT_ERROR = 'Weight must be a number up to 9999.99, with at most 2 decimals.';

// Private, so callers use the functions below and a rule can't drift from its message.
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

// Saved straight away so the set sheet can open on it. Never logged: 0 reps at 0 weight, which
// is valid and stands out if left.
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
