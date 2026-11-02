/**
 * Domain errors raised by the Scheduling module. The HTTP layer (platform/http-exception.filter.ts)
 * maps each one to a status code from the design's API contract; the domain code never sees HTTP.
 */

/** A referenced id does not exist → 404. */
export class NotFoundError extends Error {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} was not found.`);
  }
}

/** A domain rule rejects the request (outside opening hours, start in the past, vehicle not owned) → 422. */
export class BookingRuleError extends Error {}

/** No bay + qualified technician pair is free, or every insert attempt lost the race → 409. */
export class NoSlotAvailableError extends Error {
  constructor() {
    super(
      'No service bay and qualified technician are free for the full duration, including the turnaround buffer.',
    );
  }
}

/** The Idempotency-Key was already used with a different request body → 409. */
export class IdempotencyKeyMismatchError extends Error {
  constructor() {
    super('This Idempotency-Key was already used with a different request body.');
  }
}

export type OverlapResource = 'bay' | 'technician' | 'vehicle';

/**
 * Raised by AppointmentRepository when Postgres rejects an insert with SQLSTATE 23P01
 * (exclusion_violation). `resource` says which exclusion constraint fired, so the booking loop can drop
 * that bay / technician / vehicle and try the next pair. Never reaches the HTTP layer.
 */
export class SlotUnavailableError extends Error {
  constructor(
    readonly resource: OverlapResource,
    readonly constraint: string,
  ) {
    super(`Slot unavailable: ${constraint}`);
  }
}

/**
 * Raised by AppointmentRepository when the insert hits the unique idempotency_key
 * (SQLSTATE 23505 unique_violation): another request with the same key committed first.
 */
export class IdempotencyKeyTakenError extends Error {}

/**
 * Raised by AppointmentRepository when Postgres aborted our INSERT as a deadlock victim
 * (SQLSTATE 40P01): it was racing another booking for an overlapping slot. Nothing was written, so
 * the booking loop retries the same pair; the retry then commits or gets a clean 23P01.
 */
export class InsertDeadlockError extends Error {
  constructor() {
    super('Insert aborted by Postgres deadlock detection (40P01)');
  }
}
