// The response keeps the ids' order. Numbers need no URL encoding.
export function lastSetsPath(exerciseIds: readonly number[]): `/${string}` {
  return `/exercises/last-sets?ids=${exerciseIds.join(',')}`;
}
