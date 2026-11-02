/**
 * GET /availability, GET /appointments/:id, PATCH /appointments/:id/cancel against the compose Postgres.
 * January 2030 dates: London is on GMT, so "09:00Z" is 09:00 local. 2030-01-07 is a Monday.
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely } from 'kysely';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { createDb } from '../../src/db/database';
import type { Database } from '../../src/db/types';
import { Fixture, insertAppointment, resetAndBuild } from './fixture';

const MONDAY_0900 = '2030-01-07T09:00:00Z';
const UNKNOWN_ID = '00000000-0000-4000-8000-00000000dead';

let app: INestApplication;
let db: Kysely<Database>;
let f: Fixture;

beforeAll(async () => {
  const config = {
    databaseUrl: process.env.TEST_DATABASE_URL!,
    port: 0,
    logLevel: 'silent',
    swaggerEnabled: false,
  };
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(config)],
  }).compile();
  app = moduleRef.createNestApplication();
  // Listen once on an ephemeral loopback port. Without this, supertest starts and stops its own
  // listener on the un-started server around every batch of requests; with 20 requests in flight
  // at once that lifecycle could leave a request waiting forever (test timeout, then app.close()
  // hanging in afterAll on the still-open connection).
  await app.listen(0, '127.0.0.1');
  db = createDb(process.env.TEST_DATABASE_URL!, 2);
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});
beforeEach(async () => {
  f = await resetAndBuild(db);
});

const http = () => request(app.getHttpServer());
const availability = (over: Record<string, string> = {}) =>
  http()
    .get('/availability')
    .query({
      dealershipId: f.dealershipId,
      serviceTypeId: f.serviceTypeId,
      startAt: MONDAY_0900,
      ...over,
    });
const book = (over: Record<string, unknown> = {}) =>
  http()
    .post('/appointments')
    .send({
      dealershipId: f.dealershipId,
      customerId: f.customerId,
      vehicleId: f.vehicle1,
      serviceTypeId: f.serviceTypeId,
      startAt: MONDAY_0900,
      ...over,
    });
const countRows = async () =>
  Number(
    (
      await db
        .selectFrom('appointments')
        .select((e) => e.fn.countAll().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );

describe('GET /availability (FR-1)', () => {
  it('lists the free pairs for the window and writes nothing', async () => {
    const res = await availability();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      available: true,
      preferenceHonored: null,
      startAt: '2030-01-07T09:00:00.000Z',
      endAt: '2030-01-07T10:00:00.000Z',
      blockedUntil: '2030-01-07T10:15:00.000Z',
      bufferMinutes: 15,
      durationMinutes: 60,
    });
    // 2 bays x 2 MOT-qualified technicians = 4 pairs, ordered by bay id then technician id.
    const [lowBay] = [f.bay1, f.bay2].sort();
    expect(res.body.candidates).toHaveLength(4);
    expect(res.body.candidates[0].bayId).toBe(lowBay);
    expect(await countRows()).toBe(0);
  });

  it('only qualified technicians: full service lists tech1 only; preferring tech2 → preferenceHonored false', async () => {
    const res = await availability({
      serviceTypeId: f.fullServiceTypeId,
      preferredTechnicianId: f.tech2,
    });
    expect(res.status).toBe(200);
    expect(res.body.preferenceHonored).toBe(false);
    expect(
      new Set(res.body.candidates.map((c: { technicianId: string }) => c.technicianId)),
    ).toEqual(new Set([f.tech1]));
  });

  it('a slot reported available can be booked with the first candidate, then disappears', async () => {
    const before = await availability({ preferredTechnicianId: f.tech2 });
    expect(before.body).toMatchObject({ available: true, preferenceHonored: true });
    const first = before.body.candidates[0];

    const booked = await book({ preferredTechnicianId: f.tech2 });
    expect(booked.status).toBe(201);
    expect({ bayId: booked.body.bayId, technicianId: booked.body.technicianId }).toEqual(first);

    const after = await availability({ preferredTechnicianId: f.tech2 });
    expect(after.body.preferenceHonored).toBe(false); // tech2 is now held
    expect(after.body.candidates).not.toContainEqual(first);
    expect(after.body.candidates.every((c: { bayId: string }) => c.bayId !== first.bayId)).toBe(
      true,
    );
  });

  it('respects the 15-minute buffer: 10:14 shows the booked bay busy, 10:15 shows it free', async () => {
    await insertAppointment(db, f, {
      bay: f.bay1,
      tech: f.tech1,
      vehicle: f.vehicle2,
      start: MONDAY_0900,
    });
    const at1014 = await availability({ startAt: '2030-01-07T10:14:00Z' });
    expect(at1014.body.candidates).toEqual([{ bayId: f.bay2, technicianId: f.tech2 }]);
    const at1015 = await availability({ startAt: '2030-01-07T10:15:00Z' });
    expect(at1015.body.candidates).toHaveLength(4);
  });

  it('nobody free is 200 with available false', async () => {
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
    const res = await availability({ preferredTechnicianId: f.tech1 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ available: false, preferenceHonored: false, candidates: [] });
  });

  it('422 outside opening hours, 404 unknown dealership / technician, 400 bad query', async () => {
    expect((await availability({ startAt: '2030-01-06T10:00:00Z' })).status).toBe(422); // Sunday
    expect((await availability({ dealershipId: UNKNOWN_ID })).status).toBe(404);
    expect((await availability({ preferredTechnicianId: UNKNOWN_ID })).status).toBe(404);
    expect((await availability({ startAt: '2030-01-07T09:00:00' })).status).toBe(400);
    expect((await availability({ dealershipId: 'not-a-uuid' })).status).toBe(400);
  });
});

describe('GET /appointments/:id (FR-9)', () => {
  it('returns the booked appointment', async () => {
    const booked = await book();
    const res = await http().get(`/appointments/${booked.body.id}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual(booked.body);
  });

  it('404 for an unknown id, 400 for a non-UUID', async () => {
    const missing = await http().get(`/appointments/${UNKNOWN_ID}`);
    expect(missing.status).toBe(404);
    expect(missing.body).toMatchObject({ statusCode: 404, error: 'Not Found' });
    expect((await http().get('/appointments/abc')).status).toBe(400);
  });
});

describe('PATCH /appointments/:id/cancel (FR-8)', () => {
  it('cancels, frees bay + technician + vehicle (tail included), and the same window can be rebooked', async () => {
    const booked = await book({ preferredTechnicianId: f.tech1 });
    const cancelled = await http().patch(`/appointments/${booked.body.id}/cancel`);
    expect(cancelled.status).toBe(200);
    expect(cancelled.body).toMatchObject({ id: booked.body.id, status: 'cancelled' });
    expect(cancelled.body.cancelledAt).not.toBeNull();

    // Same vehicle, technician, and (lowest) bay for the same window: commits again.
    const rebooked = await book({ preferredTechnicianId: f.tech1 });
    expect(rebooked.status).toBe(201);
    expect(rebooked.body).toMatchObject({ bayId: booked.body.bayId, technicianId: f.tech1 });
  });

  it('a second cancel returns 200 with the same row and does not move cancelledAt', async () => {
    const booked = await book();
    const first = await http().patch(`/appointments/${booked.body.id}/cancel`);
    const second = await http().patch(`/appointments/${booked.body.id}/cancel`);
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
  });

  it('404 for an unknown id, 400 for a non-UUID', async () => {
    expect((await http().patch(`/appointments/${UNKNOWN_ID}/cancel`)).status).toBe(404);
    expect((await http().patch('/appointments/abc/cancel')).status).toBe(400);
  });
});
