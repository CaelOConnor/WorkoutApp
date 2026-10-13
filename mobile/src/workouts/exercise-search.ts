// Filtering for the exercise picker's search box.
import type { Exercise } from '@shared/models';

// The exercises matching `query` (part of the name or muscle group, ignoring case), minus
// `excludeIds` (e.g. the ones already in the workout), sorted by name.
export function searchExercises(
  exercises: readonly Exercise[],
  query: string,
  excludeIds: readonly number[]
): Exercise[] {
  const needle = query.trim().toLowerCase();
  return (
    exercises
      .filter((e) => !excludeIds.includes(e.id))
      .filter(
        (e) =>
          e.name.toLowerCase().includes(needle) ||
          (e.muscle_group?.toLowerCase().includes(needle) ?? false)
      )
      // sort() reorders in place, but this is the new array filter() made, so the caller's list
      // is untouched. localeCompare with sensitivity 'base' ignores case ('deadlift' < 'Front').
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  );
}
