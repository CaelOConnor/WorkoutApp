// The Log workout form as a reducer, so its rules are tested without rendering anything.
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

// Shown as placeholders. A field left empty is saved with its hint, so ticking an untouched row
// logs exactly what was done last time.
export type SetHint = Pick<SetForm, 'reps' | 'weight'>;

// Keys never change, unlike a row's position, so they identify rows for React and actions.
// Only ticked rows are saved, and typing reps or weight ticks the row.
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
  // True until last time's sets arrive. The card has no rows until then, so no row changes
  // after the user starts typing.
  loading: boolean;
}

// One set of last time, as GET /exercises/last-sets returns it.
type LastSet = ExerciseLastSets['sets'][number];

export interface LogForm {
  date: string; // 'YYYY-MM-DD'
  notes: string;
  exercises: LogExercise[];
  // The next unused key. In the state, not a module counter, so the reducer stays pure.
  nextKey: number;
}

export type LogAction =
  | { type: 'setDate'; date: string }
  | { type: 'setNotes'; notes: string }
  // `loading`: added without rows, waiting for fillLastSets. Otherwise one empty row.
  | { type: 'addExercise'; exercise: Pick<Exercise, 'id' | 'name'>; loading?: boolean }
  // null for an exercise never logged. By exercise id, not card key, since the screen knows the
  // id when the answer arrives.
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

// Row i gets last time's set i, and rows past that repeat its last set. Nothing is ticked, so
// nothing is saved until the user ticks or types.
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
    const sets = Array.from({ length: exercise.set_count }, (_, i): LogSet => {
      const key = exerciseKey + 1 + i;
      // undefined if never logged.
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

// So a new exercise starts in the unit the user is already using. 'lb' is the server's default.
function lastUnit(form: LogForm): WeightUnit {
  for (let i = form.exercises.length - 1; i >= 0; i--) {
    const unit = form.exercises[i]?.sets.at(-1)?.unit;
    if (unit) {
      return unit;
    }
  }
  return 'lb';
}

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

// Never changes `form` itself, since React only re-renders when the state is a new object.
export function logFormReducer(form: LogForm, action: LogAction): LogForm {
  switch (action.type) {
    case 'setDate':
      return { ...form, date: action.date };

    case 'setNotes':
      return { ...form, notes: action.notes };

    case 'addExercise': {
      // Once per workout, since two cards of one exercise would both number their sets from 1.
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
        // The next set is usually the same, so copy the previous one, hint and tick included.
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

// As a string, so forms compare by content. Keys, hints and spaces around notes don't count.
function enteredContent(form: LogForm): string {
  return JSON.stringify([
    form.date,
    form.notes.trim(),
    form.exercises.map((e) => [e.exerciseId, e.sets.map((s) => [s.reps, s.weight, s.unit, s.ticked])]),
  ]);
}

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
  // Keyed by LogSet.key, for ticked sets only.
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

  // No set_number: the server numbers each exercise's sets in the order they arrive.
  // Unticked rows are not checked or sent.
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
      ? // notes is left out when empty, since the body's notes is optional, not nullable.
        { date: form.date, ...(notes ? { notes } : {}), sets }
      : null;

  const setsError = setErrors.size === 0 ? NO_SETS_ERROR : null;
  return { dateError, setErrors, validSetCount, setsError, body };
}
