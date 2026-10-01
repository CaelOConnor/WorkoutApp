// Points at the postgres-test container (port 5433), never the dev database on 5432.
// Override with TEST_DATABASE_URL if needed.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://workoutapp:devpassword@localhost:5433/workoutapp_test';
