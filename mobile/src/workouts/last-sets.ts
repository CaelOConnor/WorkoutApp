// "Last time" for exercises: the sets of each one's most recent workout, which new sets are
// prefilled from (as hints). Pure logic, kept out of the hooks and screens so it's unit-tested.

// GET /exercises/last-sets for these ids, in this order (the response keeps it). Ids are numbers,
// so the comma-separated list needs no URL encoding.
export function lastSetsPath(exerciseIds: readonly number[]): `/${string}` {
  return `/exercises/last-sets?ids=${exerciseIds.join(',')}`;
}
