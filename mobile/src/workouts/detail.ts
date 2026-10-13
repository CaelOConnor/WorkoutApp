// Logic for the workout detail screen: grouping sets into exercise cards, and their text.
import type { WorkoutDetailSet } from '@shared/models';

export interface ExerciseGroup {
  exerciseId: number;
  exerciseName: string;
  sets: WorkoutDetailSet[]; // in workout order (the API sorts by set_number)
}

// One group per exercise, in the order each exercise first appears. Grouped by exercise_id, not
// name: a custom exercise can share a built-in one's name, and "Remove exercise" deletes by id.
export function groupSetsByExercise(sets: readonly WorkoutDetailSet[]): ExerciseGroup[] {
  // A Map remembers insertion order, so its values come out in first-appearance order.
  const groups = new Map<number, ExerciseGroup>();
  for (const set of sets) {
    const group = groups.get(set.exercise_id);
    if (group) {
      group.sets.push(set);
    } else {
      groups.set(set.exercise_id, {
        exerciseId: set.exercise_id,
        exerciseName: set.exercise_name,
        sets: [set],
      });
    }
  }
  return [...groups.values()];
}

// '225.00' -> '225', '132.50' -> '132.5'. The API sends NUMERIC as a string, and String(Number())
// prints the shortest form. Weights have at most 2 decimals, so no float noise can show up.
export function formatWeight(weight: string): string {
  return String(Number(weight));
}

// 'Set 1 · 5 reps × 225 lb'. `index` is the set's position within its exercise (0-based), which
// is what the user sees as the set number. The stored set_number can't be shown as is: it has
// gaps after deletes, and its scheme depends on how the set was added (1..n per exercise when a
// workout is logged, but the workout's highest + 1 for "+ Add set"; see ROADMAP.md).
export function formatSetLine(set: WorkoutDetailSet, index: number): string {
  const reps = `${set.reps} ${set.reps === 1 ? 'rep' : 'reps'}`;
  return `Set ${index + 1} · ${reps} × ${formatWeight(set.weight)} ${set.unit}`;
}

// The set that's in `after` but not in `before`: the one a POST .../sets just added. Compared by
// id rather than position, since the server sorts sets by set_number.
export function addedSet(
  before: readonly WorkoutDetailSet[],
  after: readonly WorkoutDetailSet[]
): WorkoutDetailSet | undefined {
  const oldIds = new Set(before.map((s) => s.id));
  return after.find((s) => !oldIds.has(s.id));
}

// The largest id a Postgres INTEGER (SERIAL) can hold.
const MAX_ID = 2_147_483_647;

// A route param ('/workouts/42' gives '42') as an id, or null if it can't be one. Same rule as the
// backend's parseId: digits only, no leading zero. A bad id then shows "not found" without asking
// the server. Params can also arrive as string[] (a repeated query param) or be missing.
export function parseRouteId(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return id <= MAX_ID ? id : null;
}
