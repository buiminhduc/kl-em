/**
 * Proves the double-booking invariant lives in Postgres (docs/system-design.md, Turnaround buffer):
 * exclusion constraints over [start_at, blocked_until) for bay, technician and vehicle, ignoring cancelled rows,
 * plus the CHECK that pins blocked_until = end_at + buffer_minutes. Rows are inserted directly.
 */
import 'dotenv/config';
import { Kysely } from 'kysely';
import { createDb } from '../../src/db/database';
import {
  APPOINTMENT_OVERLAP_CONSTRAINTS as C,
  PG_CHECK_VIOLATION,
  PG_EXCLUSION_VIOLATION,
} from '../../src/db/pg-errors';
import type { Database } from '../../src/db/types';
import { Fixture, insertAppointment, resetAndBuild } from './fixture';

// Monday 2 Nov 2026, Europe/London is on GMT then, so 09:00Z = 09:00 local.
const AT_0900 = '2026-11-02T09:00:00Z'; // 60-min job: end 10:00, blocked_until 10:15

let db: Kysely<Database>;
let f: Fixture;

beforeAll(() => {
  db = createDb(process.env.TEST_DATABASE_URL!, 2);
});
afterAll(async () => {
  await db.destroy();
});
beforeEach(async () => {
  f = await resetAndBuild(db);
});

async function expectPgError(p: Promise<unknown>, code: string, constraint: string) {
  await expect(p).rejects.toMatchObject({ code, constraint });
}

describe('exclusion constraints (SQLSTATE 23P01 exclusion_violation)', () => {
  it('rejects an overlapping booking on the same bay, naming the bay constraint', async () => {
    await insertAppointment(db, f, {
      bay: f.bay1,
      tech: f.tech1,
      vehicle: f.vehicle1,
      start: AT_0900,
    });
    await expectPgError(
      insertAppointment(db, f, {
        bay: f.bay1,
        tech: f.tech2,
        vehicle: f.vehicle2,
        start: '2026-11-02T09:30:00Z',
      }),
      PG_EXCLUSION_VIOLATION,
      C.bay,
    );
  });

  describe('15-minute buffer: prior job ends 10:00, resources held until 10:15', () => {
    beforeEach(async () => {
      const row = await insertAppointment(db, f, {
        bay: f.bay1,
        tech: f.tech1,
        vehicle: f.vehicle1,
        start: AT_0900,
      });
      expect(new Date(row.blocked_until).toISOString()).toBe('2026-11-02T10:15:00.000Z');
    });

    it('rejects 10:14 on the same bay', async () => {
      await expectPgError(
        insertAppointment(db, f, {
          bay: f.bay1,
          tech: f.tech2,
          vehicle: f.vehicle2,
          start: '2026-11-02T10:14:00Z',
        }),
        PG_EXCLUSION_VIOLATION,
        C.bay,
      );
    });

    it('allows 10:15 on the same bay (half-open range, touching endpoints are free)', async () => {
      await expect(
        insertAppointment(db, f, {
          bay: f.bay1,
          tech: f.tech2,
          vehicle: f.vehicle2,
          start: '2026-11-02T10:15:00Z',
        }),
      ).resolves.toBeDefined();
    });

    it('rejects 10:14 for the same technician on a different bay and vehicle', async () => {
      await expectPgError(
        insertAppointment(db, f, {
          bay: f.bay2,
          tech: f.tech1,
          vehicle: f.vehicle2,
          start: '2026-11-02T10:14:00Z',
        }),
        PG_EXCLUSION_VIOLATION,
        C.technician,
      );
    });

    it('rejects 10:14 for the same vehicle on a different bay and technician', async () => {
      await expectPgError(
        insertAppointment(db, f, {
          bay: f.bay2,
          tech: f.tech2,
          vehicle: f.vehicle1,
          start: '2026-11-02T10:14:00Z',
        }),
        PG_EXCLUSION_VIOLATION,
        C.vehicle,
      );
    });
  });

  it('cancelled rows free the bay, technician and vehicle (tail included)', async () => {
    const first = await insertAppointment(db, f, {
      bay: f.bay1,
      tech: f.tech1,
      vehicle: f.vehicle1,
      start: AT_0900,
    });
    await db
      .updateTable('appointments')
      .set({ status: 'cancelled', cancelled_at: new Date() })
      .where('id', '=', first.id)
      .execute();
    await expect(
      insertAppointment(db, f, { bay: f.bay1, tech: f.tech1, vehicle: f.vehicle1, start: AT_0900 }),
    ).resolves.toBeDefined();
  });
});

describe('appointments_buffer_matches_end (SQLSTATE 23514 check_violation)', () => {
  it('rejects a row whose blocked_until is not end_at + buffer_minutes', async () => {
    await expectPgError(
      insertAppointment(db, f, {
        bay: f.bay1,
        tech: f.tech1,
        vehicle: f.vehicle1,
        start: AT_0900,
        blockedUntil: '2026-11-02T10:10:00Z', // should be 10:15
      }),
      PG_CHECK_VIOLATION,
      'appointments_buffer_matches_end',
    );
  });
});
