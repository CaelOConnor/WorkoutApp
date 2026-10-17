// State of the template form (new template, edit template), as a reducer: a pure function
// (state, action) -> new state, like log-form.ts. The screen holds it with useReducer and only
// dispatches actions, so every rule here (no duplicate exercises, set counts within limits,
// reordering) is tested without rendering anything.
import type { Exercise, TemplateBody, TemplateDetail } from '@shared/models';

// Set counts the server accepts (template_exercises.set_count CHECK).
export const MIN_SET_COUNT = 1;
export const MAX_SET_COUNT = 20;
// What a newly added exercise starts with: a common working-set count, adjusted with the stepper.
export const DEFAULT_SET_COUNT = 3;

// templates.name is VARCHAR(100). Same rule and message as the server (parseTemplateBody).
const MAX_NAME_LENGTH = 100;
export const NAME_ERROR = 'Template names must be 1 to 100 characters';
export const NO_EXERCISES_ERROR = 'Add at least one exercise.';

// One row of the form. The key identifies the row for React and for actions and never changes,
// even when the row moves, unlike its position.
export interface TemplateFormExercise {
  key: number;
  exerciseId: number;
  name: string;
  setCount: number;
}

export interface TemplateForm {
  name: string; // as typed; trimmed when building the body
  exercises: TemplateFormExercise[];
  // The next unused key, kept in the state so the reducer stays pure (see log-form.ts).
  nextKey: number;
}

// A discriminated union on `type`, as in log-form.ts. `by` is a step for the − / + buttons.
export type TemplateAction =
  | { type: 'setName'; name: string }
  | { type: 'addExercise'; exercise: Pick<Exercise, 'id' | 'name'> }
  | { type: 'removeExercise'; exerciseKey: number }
  | { type: 'changeSetCount'; exerciseKey: number; by: number }
  | { type: 'moveExercise'; exerciseKey: number; direction: 'up' | 'down' };

export function createTemplateForm(): TemplateForm {
  return { name: '', exercises: [], nextKey: 1 };
}

// A saved template, ready to edit. Keys are 1..n; nextKey continues after them.
export function templateFormFrom(template: TemplateDetail): TemplateForm {
  const exercises = template.exercises.map((e, i) => ({
    key: i + 1,
    exerciseId: e.exercise_id,
    name: e.exercise_name,
    setCount: e.set_count,
  }));
  return { name: template.name, exercises, nextKey: exercises.length + 1 };
}

// Math.min/max keep a value inside [MIN, MAX]: "clamping".
function clampSetCount(count: number): number {
  return Math.min(MAX_SET_COUNT, Math.max(MIN_SET_COUNT, count));
}

// Every case returns a new object instead of changing `form`, or `form` itself when nothing
// changes, which tells React it needn't re-render.
export function templateFormReducer(form: TemplateForm, action: TemplateAction): TemplateForm {
  switch (action.type) {
    case 'setName':
      return { ...form, name: action.name };

    case 'addExercise': {
      // Once per template: the server rejects a duplicate, and the log screen shows one card each.
      if (form.exercises.some((e) => e.exerciseId === action.exercise.id)) {
        return form;
      }
      const exercise: TemplateFormExercise = {
        key: form.nextKey,
        exerciseId: action.exercise.id,
        name: action.exercise.name,
        setCount: DEFAULT_SET_COUNT,
      };
      return { ...form, exercises: [...form.exercises, exercise], nextKey: form.nextKey + 1 };
    }

    case 'removeExercise':
      return { ...form, exercises: form.exercises.filter((e) => e.key !== action.exerciseKey) };

    case 'changeSetCount': {
      const exercise = form.exercises.find((e) => e.key === action.exerciseKey);
      if (!exercise) {
        return form;
      }
      const setCount = clampSetCount(exercise.setCount + action.by);
      if (setCount === exercise.setCount) {
        return form;
      }
      return {
        ...form,
        exercises: form.exercises.map((e) => (e.key === action.exerciseKey ? { ...e, setCount } : e)),
      };
    }

    case 'moveExercise': {
      const from = form.exercises.findIndex((e) => e.key === action.exerciseKey);
      const to = action.direction === 'up' ? from - 1 : from + 1;
      // findIndex gives -1 for no match; `to` past either end means there's nowhere to move.
      const moving = form.exercises[from];
      const other = form.exercises[to];
      if (!moving || !other) {
        return form;
      }
      // A copy with the two rows swapped (they're next to each other, so a swap is a move).
      const exercises = [...form.exercises];
      exercises[from] = other;
      exercises[to] = moving;
      return { ...form, exercises };
    }
  }
}

// Spreading a string iterates it by Unicode code point, which is what VARCHAR counts (see the
// backend's characterCount); .length would count most emoji twice.
function characterCount(text: string): number {
  return [...text].length;
}

export interface TemplateValidation {
  nameError: string | null;
  exercisesError: string | null;
  // What POST /templates or PUT /templates/:id gets, or null while anything is invalid.
  body: TemplateBody | null;
}

export function validateTemplateForm(form: TemplateForm): TemplateValidation {
  const name = form.name.trim();
  const nameError = name.length === 0 || characterCount(name) > MAX_NAME_LENGTH ? NAME_ERROR : null;
  const exercisesError = form.exercises.length === 0 ? NO_EXERCISES_ERROR : null;
  const body: TemplateBody | null =
    nameError === null && exercisesError === null
      ? {
          name,
          // The array order is the template's order; the server stores it as positions 1..n.
          exercises: form.exercises.map((e) => ({ exercise_id: e.exerciseId, set_count: e.setCount })),
        }
      : null;
  return { nameError, exercisesError, body };
}

// What saving would store, as a string, so two forms compare by content: row keys don't matter,
// and neither do spaces around the name (they're trimmed on save).
function savedContent(form: TemplateForm): string {
  return JSON.stringify([form.name.trim(), form.exercises.map((e) => [e.exerciseId, e.setCount])]);
}

// Whether leaving would lose anything: the form differs from how it started. Changes that cancel
// out (a move up and back down) don't count.
export function templateFormChanged(form: TemplateForm, initial: TemplateForm): boolean {
  return savedContent(form) !== savedContent(initial);
}
