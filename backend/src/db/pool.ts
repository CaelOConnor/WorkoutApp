import 'dotenv/config';
import { Pool, types } from 'pg';

// By default pg turns a DATE column into a JS Date at local midnight, and res.json then sends it
// as a UTC timestamp, so '2026-09-05' could reach the client as '2026-09-04T22:00:00.000Z' on a
// server east of UTC. A DATE is a calendar day with no time zone, so keep Postgres's own text
// ('YYYY-MM-DD') instead. setTypeParser is global to the pg module: it applies to every query.
// (1082 is DATE's type OID, Postgres's internal id for the type.)
types.setTypeParser(types.builtins.DATE, (value: string) => value);

// pg also hands back NUMERIC (OID 1700) as a string ('135.00'), since NUMERIC can hold more digits
// than a JS number keeps exactly. The only NUMERIC column is sets.weight, NUMERIC(6,2): at most 6
// significant digits, well within the ~15 a float64 represents exactly, so Number() loses nothing.
// Caution: this applies to every NUMERIC result, including SUM/AVG over weight (a volume chart,
// say). Those stay exact up to ~15 digits; past that, cast in SQL or switch this parser off.
types.setTypeParser(types.builtins.NUMERIC, (value: string) => Number(value));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;
