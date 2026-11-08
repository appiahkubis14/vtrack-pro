import { types } from 'pg';

/**
 * Return DATE columns as plain "YYYY-MM-DD" text. By default the driver turns them into JavaScript Date objects at
 * local midnight, which then serialize one day early on any server whose clock is not on UTC.
 */
types.setTypeParser(1082, (v: string) => v);
