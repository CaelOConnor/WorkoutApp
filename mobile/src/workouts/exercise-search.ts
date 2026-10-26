import type { Exercise } from '@shared/models';

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
      // sort() works in place, but on filter()'s new array, so the caller's list is untouched.
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
  );
}

// Matches names like the server's duplicate check, so the offer never leads to a 409. Excluded
// exercises count too: one already in the workout still has the name.
export function createExerciseName(exercises: readonly Exercise[], query: string): string | null {
  const name = query.trim();
  const lower = name.toLowerCase();
  if (name === '' || exercises.some((e) => e.name.toLowerCase() === lower)) {
    return null;
  }
  return name;
}

// Spellings that differ only in case or spaces count as one, kept the first way they appear.
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
