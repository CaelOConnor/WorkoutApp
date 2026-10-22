import 'dotenv/config'; // loads .env into process.env (Docker passes these in anyway)
import { Pool, types } from 'pg';

// Return DATE columns as 'YYYY-MM-DD' text. By default pg makes a JS Date,
// and time zones can shift it onto the previous day.
// These parsers apply to every query in the app.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

// Return NUMERIC as a number instead of a string. Safe because weights are NUMERIC(6,2),
// small enough for a JS number to hold exactly.
types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number(value));

// Reuses a few open database connections instead of opening one per query.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;