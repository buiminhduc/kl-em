/**
 * Postgres SQLSTATE codes the application reacts to. SQLSTATE is the 5-character error code
 * Postgres returns; the first two characters are the class ("23" = integrity constraint violation).
 * Named here so no bare codes appear elsewhere in the code base.
 */

/** 23P01 exclusion_violation: a row overlaps an existing row under an EXCLUDE constraint. */
export const PG_EXCLUSION_VIOLATION = '23P01';
/** 23505 unique_violation: duplicate value in a UNIQUE / primary key (e.g. idempotency_key). */
export const PG_UNIQUE_VIOLATION = '23505';
/**
 * 40P01 deadlock_detected. Two concurrent INSERTs whose ranges overlap can each see the other's
 * not-yet-committed row while checking an EXCLUDE constraint and wait for each other; Postgres
 * breaks the cycle after deadlock_timeout (1 s by default) by aborting one of them with 40P01.
 */
export const PG_DEADLOCK_DETECTED = '40P01';
/** 23503 foreign_key_violation: referenced row does not exist. */
export const PG_FOREIGN_KEY_VIOLATION = '23503';
/** 23514 check_violation: a CHECK constraint failed (e.g. appointments_buffer_matches_end). */
export const PG_CHECK_VIOLATION = '23514';

/** Exclusion constraint names from src/db/migrations/0001_schema.ts. */
export const APPOINTMENT_OVERLAP_CONSTRAINTS = {
  bay: 'appointments_bay_no_overlap',
  technician: 'appointments_technician_no_overlap',
  vehicle: 'appointments_vehicle_no_overlap',
} as const;

/** Default Postgres name of the UNIQUE constraint on appointments.idempotency_key. */
export const APPOINTMENT_IDEMPOTENCY_KEY_CONSTRAINT = 'appointments_idempotency_key_key';

export interface PgError {
  code?: string;
  constraint?: string;
}

export function isPgError(err: unknown, code: string): err is PgError {
  return typeof err === 'object' && err !== null && (err as PgError).code === code;
}
