// State of the "Log workout" form, as a reducer: a pure function (state, action) -> new state.
// The screen holds it with useReducer and only dispatches actions, so every rule here (copying
// the previous set, no duplicate exercises, numbering) is tested without rendering anything.
import type { CreateWorkoutBody, Exercise, NewSetInput, WeightUnit } from '@shared/models';

import { isCalendarDate } from './dates';
import { DATE_ERROR, parseSetForm, repsError, weightError, type SetForm } from './forms';

// A set row: the text in its inputs (see SetForm), plus a key. Keys identify rows for React
// (the `key` prop) and for actions, and never change, unlike a row's position.
export interface LogSet extends SetForm {
  key: number;
}

export interface LogExercise {
  key: number;
  exerciseId: number;
  name: string;
  sets: LogSet[];
}

export interface LogForm {
  date: string; // 'YYYY-MM-DD'
  notes: string;
  exercises: LogExercise[];
  // The next unused key. Kept in the state (rather than a module-level counter) so the reducer
  // stays pure: the same state and action always give the same result.
  nextKey: number;
}

// A discriminated union: `type` says which action it is, and TypeScript narrows each `case` in
// the reducer to that action's fields.
export type LogAction =
  | { type: 'setDate'; date: string }
  | { type: 'setNotes'; notes: string }
  | { type: 'addExercise'; exercise: Pick<Exercise, 'id' | 'name'> }
  | { type: 'removeExercise'; exerciseKey: number }
  | { type: 'addSet'; exerciseKey: number }
  | { type: 'removeSet'; exerciseKey: number; setKey: number }
  | { type: 'updateSet'; exerciseKey: number; setKey: number; change: Partial<SetForm> };

export function createLogForm(today: string): LogForm {
  return { date: today, notes: '', exercises: [], nextKey: 1 };
}

// The unit of the most recently added set anywhere in the form, so a new exercise starts in the
// unit the user is already using. 'lb' (the server's default) when there are no sets yet.
function lastUnit(form: LogForm): WeightUnit {
  return form.exercises.at(-1)?.sets.at(-1)?.unit ?? 'lb';
}

// Applies `change` to the one exercise with this key, leaving the others as they are.
function updateExercise(
  form: LogForm,
  exerciseKey: number,
  change: (exercise: LogExercise) => LogExercise
): LogForm {
  return {
    ...form,
    exercises: form.exercises.map((e) => (e.key === exerciseKey ? change(e) : e)),
  };
}

// Every case returns a new object instead of changing `form`: React only re-renders when the
// state is a different object, and older states (e.g. a test's "before") stay as they were.
export function logFormReducer(form: LogForm, action: LogAction): LogForm {
  switch (action.type) {
    case 'setDate':
      return { ...form, date: action.date };

    case 'setNotes':
      return { ...form, notes: action.notes };

    case 'addExercise': {
      // Once per workout: two cards of one exercise would both number their sets from 1.
      // Returning the same object tells React nothing changed.
      if (form.exercises.some((e) => e.exerciseId === action.exercise.id)) {
        return form;
      }
      const exercise: LogExercise = {
        key: form.nextKey,
        exerciseId: action.exercise.id,
        name: action.exercise.name,
        sets: [{ key: form.nextKey + 1, reps: '', weight: '', unit: lastUnit(form) }],
      };
      return { ...form, exercises: [...form.exercises, exercise], nextKey: form.nextKey + 2 };
    }

    case 'removeExercise':
      return { ...form, exercises: form.exercises.filter((e) => e.key !== action.exerciseKey) };

    case 'addSet': {
      const next = updateExercise(form, action.exerciseKey, (exercise) => {
        const previous = exercise.sets.at(-1);
        // A copy of the previous set (usually the next set is the same), or an empty one.
        const values: SetForm = previous
          ? { reps: previous.reps, weight: previous.weight, unit: previous.unit }
          : { reps: '', weight: '', unit: lastUnit(form) };
        return { ...exercise, sets: [...exercise.sets, { key: form.nextKey, ...values }] };
      });
      return { ...next, nextKey: form.nextKey + 1 };
    }

    case 'removeSet':
      return updateExercise(form, action.exerciseKey, (exercise) => ({
        ...exercise,
        sets: exercise.sets.filter((s) => s.key !== action.setKey),
      }));

    case 'updateSet':
      return updateExercise(form, action.exerciseKey, (exercise) => ({
        ...exercise,
        sets: exercise.sets.map((s) => (s.key === action.setKey ? { ...s, ...action.change } : s)),
      }));
  }
}

// Whether leaving would lose anything the user did. Notes that are only spaces don't count.
export function hasChanges(form: LogForm, initialDate: string): boolean {
  return form.exercises.length > 0 || form.notes.trim() !== '' || form.date !== initialDate;
}

export interface SetErrors {
  reps: string | null;
  weight: string | null;
}

export interface LogValidation {
  dateError: string | null;
  // Keyed by LogSet.key. A Map, because the keys are numbers and it says "lookup table" clearly.
  setErrors: Map<number, SetErrors>;
  // Sets with valid reps and weight. Save is enabled once there's at least one.
  validSetCount: number;
  // What POST /workouts gets, or null while anything is invalid or there are no sets.
  body: CreateWorkoutBody | null;
}

export function validateLogForm(form: LogForm): LogValidation {
  const dateError = isCalendarDate(form.date) ? null : DATE_ERROR;
  const setErrors = new Map<number, SetErrors>();
  const sets: NewSetInput[] = [];
  let validSetCount = 0;

  for (const exercise of form.exercises) {
    // forEach's index gives each set its number within its exercise: 1..n per exercise.
    exercise.sets.forEach((set, index) => {
      setErrors.set(set.key, { reps: repsError(set.reps), weight: weightError(set.weight) });
      const parsed = parseSetForm(set);
      if (parsed.ok) {
        validSetCount += 1;
        sets.push({ exercise_id: exercise.exerciseId, set_number: index + 1, ...parsed.value });
      }
    });
  }

  const allValid = dateError === null && validSetCount === setErrors.size;
  const notes = form.notes.trim();
  const body: CreateWorkoutBody | null =
    allValid && sets.length > 0
      ? // A conditional spread: adds `notes` only when there are some, since the body's notes
        // is optional (a missing key) rather than nullable.
        { date: form.date, ...(notes ? { notes } : {}), sets }
      : null;

  return { dateError, setErrors, validSetCount, body };
}
