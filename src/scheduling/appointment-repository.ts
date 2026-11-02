import { Injectable } from '@nestjs/common';
import { Insertable, sql } from 'kysely';
import type { AppointmentsTable } from '../db/types';
import {
  APPOINTMENT_IDEMPOTENCY_KEY_CONSTRAINT,
  APPOINTMENT_OVERLAP_CONSTRAINTS,
  isPgError,
  PG_DEADLOCK_DETECTED,
  PG_EXCLUSION_VIOLATION,
  PG_UNIQUE_VIOLATION,
} from '../db/pg-errors';
import { DatabaseService } from '../platform/database.provider';
import {
  IdempotencyKeyTakenError,
  InsertDeadlockError,
  OverlapResource,
  SlotUnavailableError,
} from './errors';
import type { AppointmentRow } from './scheduling.types';

export interface BlockedRange {
  startAt: Date;
  blockedUntil: Date;
}

const RESOURCE_BY_CONSTRAINT: Record<string, OverlapResource> = {
  [APPOINTMENT_OVERLAP_CONSTRAINTS.bay]: 'bay',
  [APPOINTMENT_OVERLAP_CONSTRAINTS.technician]: 'technician',
  [APPOINTMENT_OVERLAP_CONSTRAINTS.vehicle]: 'vehicle',
};

/**
 * All SQL for appointments. The free-resource queries use the same predicate as the exclusion
 * constraints: a non-cancelled row whose half-open range [start_at, blocked_until) overlaps (&&) ours.
 * Postgres driver error codes are translated here, so the policy code never sees them.
 */
@Injectable()
export class AppointmentRepository {
  constructor(private readonly database: DatabaseService) {}

  async findFreeBays(dealershipId: string, range: BlockedRange): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom('service_bays as b')
      .select('b.id')
      .where('b.dealership_id', '=', dealershipId)
      .where('b.active', '=', true)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('appointments as a')
              .select('a.id')
              .whereRef('a.bay_id', '=', 'b.id')
              .where('a.status', '<>', 'cancelled')
              .where(overlaps(range)),
          ),
        ),
      )
      .orderBy('b.id')
      .execute();
    return rows.map((r) => r.id);
  }

  /** Active technicians of the dealership who hold the skill and are not blocked in the range. */
  async findFreeTechnicians(
    dealershipId: string,
    skillCode: string,
    range: BlockedRange,
  ): Promise<string[]> {
    const rows = await this.database.db
      .selectFrom('technicians as t')
      .innerJoin('technician_skills as ts', 'ts.technician_id', 't.id')
      .select('t.id')
      .where('t.dealership_id', '=', dealershipId)
      .where('t.active', '=', true)
      .where('ts.skill_code', '=', skillCode)
      .where(({ not, exists, selectFrom }) =>
        not(
          exists(
            selectFrom('appointments as a')
              .select('a.id')
              .whereRef('a.technician_id', '=', 't.id')
              .where('a.status', '<>', 'cancelled')
              .where(overlaps(range)),
          ),
        ),
      )
      .orderBy('t.id')
      .execute();
    return rows.map((r) => r.id);
  }

  /**
   * One INSERT = one implicit transaction (one attempt). Translates:
   * - 23P01 exclusion_violation → SlotUnavailableError naming the bay / technician / vehicle constraint;
   * - 23505 unique_violation on idempotency_key → IdempotencyKeyTakenError.
   */
  async insert(values: Insertable<AppointmentsTable>): Promise<AppointmentRow> {
    try {
      return await this.database.db.transaction().execute(async (trx) => {
        // Queue concurrent inserts for the same bay / technician / vehicle behind each other for the
        // few milliseconds of this transaction. Without it, two overlapping INSERTs each see the
        // other's uncommitted row in the EXCLUDE check and wait on each other: a deadlock that
        // Postgres only breaks after deadlock_timeout (1 s), once per cycle, so 20 parallel posts
        // took 5 s+. With it, the waiter inserts after the winner commits and gets a clean 23P01.
        // pg_advisory_xact_lock is released automatically at COMMIT/ROLLBACK. Keys are locked in a
        // fixed (sorted) order so two inserts can never take them in opposite order.
        // The exclusion constraints still decide who wins; this lock only removes the deadlock.
        const keys = [values.bay_id, values.technician_id, values.vehicle_id].sort();
        for (const key of keys) {
          await sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`.execute(trx);
        }
        return trx
          .insertInto('appointments')
          .values(values)
          .returningAll()
          .executeTakeFirstOrThrow();
      });
    } catch (err) {
      if (isPgError(err, PG_EXCLUSION_VIOLATION)) {
        const constraint = err.constraint ?? 'unknown';
        const resource = RESOURCE_BY_CONSTRAINT[constraint];
        if (resource) throw new SlotUnavailableError(resource, constraint);
      }
      if (
        isPgError(err, PG_UNIQUE_VIOLATION) &&
        err.constraint === APPOINTMENT_IDEMPOTENCY_KEY_CONSTRAINT
      ) {
        throw new IdempotencyKeyTakenError();
      }
      if (isPgError(err, PG_DEADLOCK_DETECTED)) throw new InsertDeadlockError();
      throw err;
    }
  }

  async findById(id: string): Promise<AppointmentRow | undefined> {
    return this.database.db
      .selectFrom('appointments')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
  }

  /**
   * Cancels only a confirmed row (single UPDATE, so two concurrent cancels cannot both "win").
   * Returns undefined when the id is unknown or the row was already cancelled.
   */
  async markCancelled(id: string): Promise<AppointmentRow | undefined> {
    return this.database.db
      .updateTable('appointments')
      .set({ status: 'cancelled', cancelled_at: sql<Date>`now()` })
      .where('id', '=', id)
      .where('status', '=', 'confirmed')
      .returningAll()
      .executeTakeFirst();
  }

  async findByIdempotencyKey(key: string): Promise<AppointmentRow | undefined> {
    return this.database.db
      .selectFrom('appointments')
      .selectAll()
      .where('idempotency_key', '=', key)
      .executeTakeFirst();
  }
}

/** tstzrange(a.start_at, a.blocked_until, '[)') && tstzrange($start, $blockedUntil, '[)') */
function overlaps(range: BlockedRange) {
  return sql<boolean>`tstzrange(a.start_at, a.blocked_until, '[)') && tstzrange(${range.startAt}, ${range.blockedUntil}, '[)')`;
}
