import 'dotenv/config';
import { Pool, types } from 'pg';

// By default pg turns a DATE column into a JS Date at local midnight, and res.json then sends it
// as a UTC timestamp, so '2026-09-05' could reach the client as '2026-09-04T22:00:00.000Z' on a
// server east of UTC. A DATE is a calendar day with no time zone, so keep Postgres's own text
// ('YYYY-MM-DD') instead. setTypeParser is global to the pg module: it applies to every query.
// (1082 is DATE's type OID, Postgres's internal id for the type.)
types.setTypeParser(types.builtins.DATE, (value: string) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export default pool;
