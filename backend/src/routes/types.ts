// Params type for routes with no URL params, like POST /workouts.
// Lives here, not in models.ts, because it's Express-only and the app doesn't need it.
export type NoParams = Record<string, never>;