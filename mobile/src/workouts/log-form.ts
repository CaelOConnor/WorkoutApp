// State of the "Log workout" form, as a reducer: a pure function (state, action) -> new state.
// The screen holds it with useReducer and only dispatches actions, so every rule here (copying
// the previous set, no duplicate exercises, numbering) is tested without rendering anything.
import type {
  CreateWorkoutBody,
  Exercise,
  ExerciseLastSets,
  NewSetInput,
  TemplateDetail,
  WeightUnit,
} from '@shared/models';

import { isCalendarDate } from './dates';
import { DATE_ERROR, parseSetForm, repsError, weightError, type SetForm } from './forms';

// Last time's numbers for a row, shown greyed out as the inputs' placeholders. A field left empty
// is saved with its hint, so ticking ✓ on an untouched row logs exactly what was done last time.
export type SetHint = Pick<SetForm, 'reps' | 'weight'>;

// A set row: the text in its inputs (see SetForm), plus a key. Keys identify rows for React
// (the `key` prop) and for actions, and never change, unlike a row's position.
// Only ticked rows are saved: ✓ ticks and unticks, and typing reps or weight ticks the row.
export interface LogSet extends SetForm {
  key: number;
  hint: SetHint | null;
  ticked: boolean;
}

// Shown when Save is pressed with no row ticked.
export const NO_SETS_ERROR = 'Tick ✓ on at least one set to save the workout.';

export interface LogExercise {
  key: number;
  exerciseId: number;
  name: string;
  sets: LogSet[];
  // True from picking the exercise until last time's sets have arrived (fillLastSets): the card
  // shows a spinner and has no rows yet, so no row changes after the user starts typing.
  loading: boolean;
}

// One set of last time, as GET /exercises/last-sets returns it.
type LastSet = ExerciseLastSets['sets'][number];

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
  // `loading`: added without rows, waiting for fillLastSets. Otherwise one empty row.
  | { type: 'addExercise'; exercise: Pick<Exercise, 'id' | 'name'>; loading?: boolean }
  // Last time's sets for a loading card; null (or none) for an exercise never logged. By exercise
  // id, which the screen knows when the answer arrives (unlike the card's key), and which is in
  // the form at most once.
  | { type: 'fillLastSets'; exerciseId: number; lastSets: readonly LastSet[] | null }
  | { type: 'removeExercise'; exerciseKey: number }
  | { type: 'addSet'; exerciseKey: number }
  | { type: 'removeSet'; exerciseKey: number; setKey: number }
  | { type: 'updateSet'; exerciseKey: number; setKey: number; change: Partial<SetForm> }
  | { type: 'toggleSet'; exerciseKey: number; setKey: number };

export function createLogForm(today: string): LogForm {
  return { date: today, notes: '', exercises: [], nextKey: 1 };
}

// A row with nothing typed, no hint and no tick: left like that, it isn't saved.
function emptySet(key: number, unit: WeightUnit): LogSet {
  return { key, reps: '', weight: '', unit, hint: null, ticked: false };
}

// A row hinted with one of last time's sets, in its unit. Untouched and unticked.
function hintedSet(key: number, last: LastSet): LogSet {
  return {
    ...emptySet(key, last.unit),
    hint: { reps: String(last.reps), weight: String(last.weight) },
  };
}

// "Start workout" on a template: its exercises in order, each with set_count rows hinted from
// last time (GET /exercises/last-sets). Row i gets last time's set i; rows beyond what was done
// last time repeat its last set; a template with fewer rows uses the first ones. Each row takes
// that set's unit. An exercise never logged gets empty rows, in the unit used last, as adding one
// by hand does. Nothing is ticked, so nothing is saved until the user ticks or types.
export function createLogFormFromTemplate(
  today: string,
  template: TemplateDetail,
  lastSets: readonly ExerciseLastSets[]
): LogForm {
  let form = createLogForm(today);
  for (const exercise of template.exercises) {
    const last = lastSets.find((l) => l.exercise_id === exercise.exercise_id)?.sets ?? [];
    const unit = lastUnit(form);
    const exerciseKey = form.nextKey;
    // Array.from({ length: n }, fn) builds an n-item array from fn(_, index).
    const sets = Array.from({ length: exercise.set_count }, (_, i): LogSet => {
      const key = exerciseKey + 1 + i;
      // `??`: last time's set i, or (past its end) its last set; undefined if never logged.
      const previous = last[i] ?? last.at(-1);
      return previous ? hintedSet(key, previous) : emptySet(key, unit);
    });
    form = {
      ...form,
      exercises: [
        ...form.exercises,
        {
          key: exerciseKey,
          exerciseId: exercise.exercise_id,
          name: exercise.exercise_name,
          sets,
          loading: false,
        },
      ],
      nextKey: exerciseKey + 1 + sets.length,
    };
  }
  return form;
}

// The unit of the most recently added set anywhere in the form, so a new exercise starts in the
// unit the user is already using. 'lb' (the server's default) when there are no sets yet.
// Exercises without rows (a card still loading, or one whose sets were all removed) are skipped.
function lastUnit(form: LogForm): WeightUnit {
  for (let i = form.exercises.length - 1; i >= 0; i--) {
    const unit = form.exercises[i]?.sets.at(-1)?.unit;
    if (unit) {
      return unit;
    }
  }
  return 'lb';
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
      const loading = action.loading ?? false;
      const exercise: LogExercise = {
        key: form.nextKey,
        exerciseId: action.exercise.id,
        name: action.exercise.name,
        sets: loading ? [] : [emptySet(form.nextKey + 1, lastUnit(form))],
        loading,
      };
      return { ...form, exercises: [...form.exercises, exercise], nextKey: form.nextKey + 2 };
    }

    case 'fillLastSets': {
      const exercise = form.exercises.find((e) => e.exerciseId === action.exerciseId);
      // Only once, and only for a card still there: the answer can arrive after the user removed
      // the card, and it must never replace rows the user may already be typing into.
      if (!exercise?.loading) {
        return form;
      }
      const last = action.lastSets ?? [];
      const sets =
        last.length > 0
          ? last.map((set, i) => hintedSet(form.nextKey + i, set))
          : [emptySet(form.nextKey, lastUnit(form))];
      const next = updateExercise(form, exercise.key, (e) => ({ ...e, sets, loading: false }));
      return { ...next, nextKey: form.nextKey + sets.length };
    }

    case 'removeExercise':
      return { ...form, exercises: form.exercises.filter((e) => e.key !== action.exerciseKey) };

    case 'addSet': {
      // A loading card has no rows to copy yet, and its rows are about to arrive.
      if (form.exercises.some((e) => e.key === action.exerciseKey && e.loading)) {
        return form;
      }
      const next = updateExercise(form, action.exerciseKey, (exercise) => {
        const previous = exercise.sets.at(-1);
        // A copy of the previous set (usually the next set is the same), hint and tick included,
        // or an empty one.
        const set: LogSet = previous
          ? { ...previous, key: form.nextKey }
          : emptySet(form.nextKey, lastUnit(form));
        return { ...exercise, sets: [...exercise.sets, set] };
      });
      return { ...next, nextKey: form.nextKey + 1 };
    }

    case 'removeSet':
      return updateExercise(form, action.exerciseKey, (exercise) => ({
        ...exercise,
        sets: exercise.sets.filter((s) => s.key !== action.setKey),
      }));

    case 'updateSet': {
      // Typing reps or weight means the set was done, so it ticks the row. A unit change alone
      // doesn't: it's a correction, not a set.
      const typed = action.change.reps !== undefined || action.change.weight !== undefined;
      return updateExercise(form, action.exerciseKey, (exercise) => ({
        ...exercise,
        sets: exercise.sets.map((s) =>
          s.key === action.setKey ? { ...s, ...action.change, ticked: s.ticked || typed } : s
        ),
      }));
    }

    case 'toggleSet':
      return updateExercise(form, action.exerciseKey, (exercise) => ({
        ...exercise,
        sets: exercise.sets.map((s) => (s.key === action.setKey ? { ...s, ticked: !s.ticked } : s)),
      }));
  }
}

// What the user has entered, as a string, so two forms compare by content (as in
// template-form.ts): keys and hints don't count (hints never change), nor spaces around notes.
function enteredContent(form: LogForm): string {
  return JSON.stringify([
    form.date,
    form.notes.trim(),
    form.exercises.map((e) => [e.exerciseId, e.sets.map((s) => [s.reps, s.weight, s.unit, s.ticked])]),
  ]);
}

// Whether leaving would lose anything the user did: the form differs from how it started (an
// empty workout, or one prefilled from a template).
export function hasChanges(form: LogForm, initial: LogForm): boolean {
  return enteredContent(form) !== enteredContent(initial);
}

// The values a row saves: each field as typed, or its hint where nothing was typed.
function setValues(set: LogSet): SetForm {
  return {
    reps: set.reps.trim() === '' && set.hint ? set.hint.reps : set.reps,
    weight: set.weight.trim() === '' && set.hint ? set.hint.weight : set.weight,
    unit: set.unit,
  };
}

export interface SetErrors {
  reps: string | null;
  weight: string | null;
}

export interface LogValidation {
  dateError: string | null;
  // Keyed by LogSet.key, for ticked sets only. A Map, because the keys are numbers and it says
  // "lookup table" clearly.
  setErrors: Map<number, SetErrors>;
  // Ticked sets with valid reps and weight.
  validSetCount: number;
  // NO_SETS_ERROR while no set is ticked, else null.
  setsError: string | null;
  // What POST /workouts gets, or null while anything ticked is invalid or nothing is ticked.
  body: CreateWorkoutBody | null;
}

export function validateLogForm(form: LogForm): LogValidation {
  const dateError = isCalendarDate(form.date) ? null : DATE_ERROR;
  const setErrors = new Map<number, SetErrors>();
  const sets: NewSetInput[] = [];
  let validSetCount = 0;

  // Sets go in form order with no set_number: the server numbers each exercise's sets 1..n in
  // the order they arrive. Unticked rows are skipped entirely: not checked, not sent.
  for (const exercise of form.exercises) {
    for (const row of exercise.sets) {
      if (!row.ticked) {
        continue;
      }
      const set = setValues(row);
      setErrors.set(row.key, { reps: repsError(set.reps), weight: weightError(set.weight) });
      const parsed = parseSetForm(set);
      if (parsed.ok) {
        validSetCount += 1;
        sets.push({ exercise_id: exercise.exerciseId, ...parsed.value });
      }
    }
  }

  const allValid = dateError === null && validSetCount === setErrors.size;
  const notes = form.notes.trim();
  const body: CreateWorkoutBody | null =
    allValid && sets.length > 0
      ? // A conditional spread: adds `notes` only when there are some, since the body's notes
        // is optional (a missing key) rather than nullable.
        { date: form.date, ...(notes ? { notes } : {}), sets }
      : null;

  const setsError = setErrors.size === 0 ? NO_SETS_ERROR : null;
  return { dateError, setErrors, validSetCount, setsError, body };
}
