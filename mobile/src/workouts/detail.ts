import type { WorkoutDetailSet } from '@shared/models';

export interface ExerciseGroup {
  exerciseId: number;
  exerciseName: string;
  sets: WorkoutDetailSet[]; // in the API's order: by set_number within the exercise
}

// By exercise_id, not name: a custom exercise can share a built-in one's name, and Remove
// exercise deletes by id.
export function groupSetsByExercise(sets: readonly WorkoutDetailSet[]): ExerciseGroup[] {
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

// 'Set 1 · 5 reps × 225 lb'. Numbered by position in the list, not by the stored set_number.
export function formatSetLine(set: WorkoutDetailSet, index: number): string {
  const reps = `${set.reps} ${set.reps === 1 ? 'rep' : 'reps'}`;
  return `Set ${index + 1} · ${reps} × ${set.weight} ${set.unit}`;
}

// The set a POST .../sets just added. Found by id, since a new set isn't always last in the list.
export function addedSet(
  before: readonly WorkoutDetailSet[],
  after: readonly WorkoutDetailSet[]
): WorkoutDetailSet | undefined {
  const oldIds = new Set(before.map((s) => s.id));
  return after.find((s) => !oldIds.has(s.id));
}

// The largest id a Postgres INTEGER (SERIAL) can hold.
const MAX_ID = 2_147_483_647;

// Same rule as the backend's parseId, so a bad id shows "not found" without asking the server.
export function parseRouteId(value: string | string[] | undefined): number | null {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    return null;
  }
  const id = Number(value);
  return id <= MAX_ID ? id : null;
}
