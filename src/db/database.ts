import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { Database } from './types';

/**
 * Called when an idle pooled connection fails, e.g. Postgres restarts and terminates it
 * (SQLSTATE 57P01 admin_shutdown). pg removes the dead client from the pool itself, but emits
 * 'error' on the Pool; with no listener Node treats that as an unhandled 'error' event and the
 * process crashes. The default just reports it; the next query opens a fresh connection.
 */
export type PoolErrorHandler = (err: Error) => void;

const reportIdleClientError: PoolErrorHandler = (err) => {
  console.warn(`postgres idle client error: ${err.message}`);
};

export function createDb(
  connectionString: string,
  max = 10,
  onPoolError: PoolErrorHandler = reportIdleClientError,
): Kysely<Database> {
  const pool = new Pool({ connectionString, max });
  pool.on('error', onPoolError);
  return new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
}
