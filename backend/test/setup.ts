import { TEST_DATABASE_URL } from './test-env';

// Runs in each test worker before the test file's imports, so these are in place when
// app.ts and db/pool.ts read process.env.

// app.ts throws at import time if JWT_SECRET is missing, so give tests a fixed one.
process.env.JWT_SECRET = 'test-secret';
// pool.ts loads backend/.env via dotenv, but dotenv never overwrites a variable that is
// already set, so this keeps tests off the dev database.
process.env.DATABASE_URL = TEST_DATABASE_URL;
