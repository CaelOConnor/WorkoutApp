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

// The name to offer as 'Create "<name>"' for a search, or null when there's nothing to create: the
// search is blank, or an exercise already has exactly that name (ignoring case and surrounding
// spaces, like the server's duplicate check, so the offer never leads to a certain 409).
// Checks every exercise, including excluded ones: one already in the workout still has the name.
export function createExerciseName(exercises: readonly Exercise[], query: string): string | null {
  const name = query.trim();
  const lower = name.toLowerCase();
  if (name === '' || exercises.some((e) => e.name.toLowerCase() === lower)) {
    return null;
  }
  return name;
}

// The muscle groups the exercises use, each once, sorted ignoring case: the quick choices when
// creating an exercise. Spellings that differ only in case or surrounding spaces ('Legs', ' legs')
// count as one, shown the first way they appear. A Map keyed by the lowercase spelling does that:
// set() is skipped for a key that's already there, so the first spelling stays.
export function muscleGroups(exercises: readonly Exercise[]): string[] {
  const groups = new Map<string, string>();
  for (const { muscle_group } of exercises) {
    const group = muscle_group?.trim();
    if (group && !groups.has(group.toLowerCase())) {
      groups.set(group.toLowerCase(), group);
    }
  }
  return [...groups.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
