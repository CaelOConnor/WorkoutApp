import { TEST_DATABASE_URL, TEST_JWT_SECRET } from './test-env';

// Runs in each test worker before the test file's imports, so app.ts and pool.ts see these values.

// app.ts throws at import time if JWT_SECRET is missing.
process.env.JWT_SECRET = TEST_JWT_SECRET;
// dotenv never overwrites a variable that is already set, so backend/.env can't point tests at the dev database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
