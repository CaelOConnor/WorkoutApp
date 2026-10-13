// Text for one row of the workout history.
import type { WorkoutDetailSet } from '@shared/models';

// 'Squat, Bench Press': each exercise once, in the order it was first done. A Set keeps insertion
// order and ignores duplicates, which is exactly that. Keyed by name, not exercise_id, because the
// name is what's shown: a custom exercise named like a built-in one would otherwise appear twice.
export function exerciseNames(sets: readonly WorkoutDetailSet[]): string {
  if (sets.length === 0) {
    return 'No exercises';
  }
  return [...new Set(sets.map((s) => s.exercise_name))].join(', ');
}

export function setCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'set' : 'sets'}`;
}
