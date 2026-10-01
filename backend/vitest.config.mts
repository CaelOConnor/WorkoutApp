import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Runs once before all test files: rebuilds the test database schema.
    globalSetup: ['test/global-setup.ts'],
    // Runs in each test worker before the test file, so env vars are set before app.ts reads them.
    setupFiles: ['test/setup.ts'],
    // All test files share one database, so run files one at a time to keep their
    // TRUNCATEs from wiping each other's data mid-test.
    fileParallelism: false,
  },
});
