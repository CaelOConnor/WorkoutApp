// Points at the postgres-test container (port 5433), never the dev database on 5432.
// Override with TEST_DATABASE_URL if needed.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://workoutapp:devpassword@localhost:5433/workoutapp_test';

// The secret tests sign tokens with. setup.ts hands it to the app as JWT_SECRET, and tests
// that build tokens by hand use it directly, so the two can't drift apart.
export const TEST_JWT_SECRET = 'test-secret';
