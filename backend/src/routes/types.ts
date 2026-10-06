// Shared by the routers. None of our routes use URL params like /workouts/:id yet, so the
// params type is an empty object. Kept out of types/models.ts because that file is for data
// shapes the mobile app will reuse, and this is an Express detail.
export type NoParams = Record<string, never>;
