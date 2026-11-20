import Knex from 'knex';
import { env } from './env';

// A DATE column (a date of birth, a date of death, a repeat due) is a plain
// calendar day. Left to the driver it becomes midnight in the server's own
// time zone, which reads as the day before once sent as UTC: saving a form
// with no changes moved a birthday back a day each time. Keep it as the
// "YYYY-MM-DD" text Postgres sends, end to end.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pgTypes = require('pg').types as { setTypeParser: (oid: number, parse: (value: string) => unknown) => void };
const PG_DATE_OID = 1082;
pgTypes.setTypeParser(PG_DATE_OID, (value: string) => value);

export const db = Knex({
  client: 'pg',
  connection: env.DATABASE_URL,
  pool: { min: 2, max: 10 },
});
