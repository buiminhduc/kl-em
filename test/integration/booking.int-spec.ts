/**
 * POST /appointments against the real compose Postgres (scheduler_test). The Nest app runs in-process
 * (supertest) with the production module; only BookingHooks is overridden, to script a race.
 * Dates are in January 2030: London is on GMT then, so "09:00Z" is 09:00 local. 2030-01-07 is a Monday.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely } from 'kysely';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { createDb } from '../../src/db/database';
import type { Database } from '../../src/db/types';
import { BookingHooks } from '../../src/scheduling/booking-hooks';
import type { BookingWindow, Candidate } from '../../src/scheduling/scheduling.types';
import { addVehicles, Fixture, insertAppointment, resetAndBuild } from './fixture';

const MONDAY_0900 = '2030-01-07T09:00:00Z';

/** Test double for the design's afterCandidatesSelected seam; no-op unless a test sets `run`. */
class ScriptedHooks extends BookingHooks {
  run?: (candidates: Candidate[], window: BookingWindow) => Promise<void>;
  async afterCandidatesSelected(candidates: Candidate[], window: BookingWindow) {
    await this.run?.(candidates, window);
  }
}

let app: INestApplication;
let db: Kysely<Database>; // second connection pool, as "another client" for scripted conflicts
let f: Fixture;
const hooks = new ScriptedHooks();

beforeAll(async () => {
  const config = {
    databaseUrl: process.env.TEST_DATABASE_URL!,
    port: 0,
    logLevel: process.env.DBG ? 'debug' : 'silent',
    swaggerEnabled: false,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(BookingHooks)
    .useValue(hooks)
    .compile();
  app = moduleRef.createNestApplication();
  // Listen once on an ephemeral loopback port. Without this, supertest starts and stops its own
  // listener on the un-started server around every batch of requests; with 20 requests in flight
  // at once that lifecycle could leave a request waiting forever (test timeout, then app.close()
  // hanging in afterAll on the still-open connection).
  await app.listen(0, '127.0.0.1');
  db = createDb(process.env.TEST_DATABASE_URL!, 4);
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
beforeEach(async () => {
  hooks.run = undefined;
  f = await resetAndBuild(db);
});

const body = (over: Record<string, unknown> = {}) => ({
  dealershipId: f.dealershipId,
  customerId: f.customerId,
  vehicleId: f.vehicle1,
  serviceTypeId: f.serviceTypeId,
  startAt: MONDAY_0900,
  ...over,
});
const post = (b: object, key?: string) => {
  const r = request(app.getHttpServer()).post('/appointments').send(b);
  return key ? r.set('Idempotency-Key', key) : r;
};
const countRows = async () =>
  Number(
    (
      await db
        .selectFrom('appointments')
        .select((e) => e.fn.countAll().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );

describe('POST /appointments', () => {
  it('201: assigns a bay and a qualified technician, end = start + duration, blocked_until = end + 15', async () => {
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      startAt: '2030-01-07T09:00:00.000Z',
      endAt: '2030-01-07T10:00:00.000Z',
      blockedUntil: '2030-01-07T10:15:00.000Z',
      bufferMinutes: 15,
      status: 'confirmed',
      preferenceHonored: null,
      preferredTechnicianId: null,
    });
    expect([f.bay1, f.bay2]).toContain(res.body.bayId);
    expect([f.tech1, f.tech2]).toContain(res.body.technicianId);
    expect(await countRows()).toBe(1);
  });

  it('soft preference honored when the preferred technician is free and qualified', async () => {
    const res = await post(body({ preferredTechnicianId: f.tech2 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ technicianId: f.tech2, preferenceHonored: true });
  });

  it('falls back when the preferred technician lacks the skill (full service, tech2)', async () => {
    const res = await post(
      body({ serviceTypeId: f.fullServiceTypeId, preferredTechnicianId: f.tech2 }),
    );
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ technicianId: f.tech1, preferenceHonored: false });
  });

  it('falls back when the preferred technician is busy', async () => {
    await insertAppointment(db, f, {
      bay: f.bay1,
      tech: f.tech1,
      vehicle: f.vehicle2,
      start: MONDAY_0900,
    });
    const res = await post(body({ preferredTechnicianId: f.tech1 }));
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      technicianId: f.tech2,
      bayId: f.bay2,
      preferenceHonored: false,
    });
  });

  it('404 for an unknown preferred technician, and nothing is written', async () => {
    const res = await post(body({ preferredTechnicianId: '00000000-0000-4000-8000-00000000dead' }));
    expect(res.status).toBe(404);
    expect(await countRows()).toBe(0);
  });

  it('opening hours: 17:00 60-min 201 (buffer to 18:15), 17:00 90-min 422, Sunday 422', async () => {
    const ok = await post(body({ startAt: '2030-01-07T17:00:00Z' }));
    expect(ok.status).toBe(201);
    expect(ok.body.blockedUntil).toBe('2030-01-07T18:15:00.000Z');
    const late = await post(
      body({
        vehicleId: f.vehicle2,
        serviceTypeId: f.fullServiceTypeId,
        startAt: '2030-01-08T17:00:00Z',
      }),
    );
    expect(late.status).toBe(422);
    expect(late.body).toMatchObject({ statusCode: 422, error: 'Unprocessable Entity' });
    const sunday = await post(body({ vehicleId: f.vehicle3, startAt: '2030-01-06T10:00:00Z' }));
    expect(sunday.status).toBe(422);
  });

  it('400 for a startAt without an offset, with the design error body and request id', async () => {
    const res = await post(body({ startAt: '2030-01-07T09:00:00' })).set('X-Request-Id', 'req-400');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ statusCode: 400, error: 'Bad Request', requestId: 'req-400' });
    expect(res.body.message).toMatch(/offset/);
  });

  it('409 when no bay + qualified technician pair is free, nothing written', async () => {
    await insertAppointment(db, f, {
      bay: f.bay1,
      tech: f.tech1,
      vehicle: f.vehicle2,
      start: MONDAY_0900,
    });
    await insertAppointment(db, f, {
      bay: f.bay2,
      tech: f.tech2,
      vehicle: f.vehicle3,
      start: MONDAY_0900,
    });
    const res = await post(body());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ statusCode: 409, error: 'Conflict' });
    expect(res.body.message).toMatch(/No service bay and qualified technician are free/);
    expect(await countRows()).toBe(2);
  });

  it('scripted race: a genuine 23P01 on the first pair, the retry commits the next pair', async () => {
    let first: Candidate | undefined;
    hooks.run = async (candidates) => {
      first = candidates[0];
      // Another client commits on the first pair's bay between "read free pairs" and our INSERT.
      const other = first.technicianId === f.tech1 ? f.tech2 : f.tech1;
      await insertAppointment(db, f, {
        bay: first.bayId,
        tech: other,
        vehicle: f.vehicle2,
        start: MONDAY_0900,
      });
    };
    const res = await post(body());
    expect(res.status).toBe(201);
    expect(res.body.bayId).not.toBe(first!.bayId);
    expect(await countRows()).toBe(2);
  });

  it('409 after the retries are exhausted: every candidate is taken during the race', async () => {
    hooks.run = async () => {
      await insertAppointment(db, f, {
        bay: f.bay1,
        tech: f.tech1,
        vehicle: f.vehicle2,
        start: MONDAY_0900,
      });
      await insertAppointment(db, f, {
        bay: f.bay2,
        tech: f.tech2,
        vehicle: f.vehicle3,
        start: MONDAY_0900,
      });
    };
    const res = await post(body());
    expect(res.status).toBe(409);
    expect(await countRows()).toBe(2);
  });

  it('Idempotency-Key: same key + same body replays 200 with the same appointment', async () => {
    const first = await post(body(), 'key-replay');
    expect(first.status).toBe(201);
    const again = await post(body({ startAt: '2030-01-07T09:00:00+00:00' }), 'key-replay');
    expect(again.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(await countRows()).toBe(1);
  });

  it('Idempotency-Key: same key + different body is 409', async () => {
    expect((await post(body(), 'key-mismatch')).status).toBe(201);
    const res = await post(body({ startAt: '2030-01-07T11:00:00Z' }), 'key-mismatch');
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/Idempotency-Key/);
    expect(await countRows()).toBe(1);
  });

  it('concurrency: 20 parallel posts for one free pair give exactly one 201 and nineteen 409s', async () => {
    // One free pair: full service needs tech1 (only he has the skill), and bay2 is deactivated.
    await db.updateTable('service_bays').set({ active: false }).where('id', '=', f.bay2).execute();
    const vehicles = await addVehicles(db, f, 20);
    const responses = await Promise.all(
      vehicles.map((vehicleId) => post(body({ vehicleId, serviceTypeId: f.fullServiceTypeId }))),
    );
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(19);
    expect(await countRows()).toBe(1);
  });
});
