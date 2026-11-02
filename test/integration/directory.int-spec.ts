/**
 * Read-only Directory API: GET /dealerships and GET /dealerships/:id against scheduler_test,
 * using the test fixture (not the demo seed).
 */
import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Kysely } from 'kysely';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { createDb } from '../../src/db/database';
import type { Database } from '../../src/db/types';
import { Fixture, resetAndBuild } from './fixture';

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
  // Listen once on an ephemeral loopback port (see booking.int-spec.ts for why).
  await app.listen(0, '127.0.0.1');
  db = createDb(process.env.TEST_DATABASE_URL!, 2);
  f = await resetAndBuild(db);
});
afterAll(async () => {
  await app.close();
  await db.destroy();
});

const http = () => request(app.getHttpServer());

describe('GET /dealerships', () => {
  it('lists dealerships ordered by name with id, name and timezone only', async () => {
    const other = randomUUID();
    await db
      .insertInto('dealerships')
      .values({ id: other, name: 'Alpha Motors', timezone: 'Europe/Paris', buffer_minutes: 10 })
      .execute();
    try {
      const res = await http().get('/dealerships');
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        { id: other, name: 'Alpha Motors', timezone: 'Europe/Paris' },
        { id: f.dealershipId, name: 'Test site', timezone: 'Europe/London' },
      ]);
    } finally {
      await db.deleteFrom('dealerships').where('id', '=', other).execute();
    }
  });
});

describe('GET /dealerships/:id', () => {
  it('returns hours, bays, technicians with skills and service types', async () => {
    await db.updateTable('service_bays').set({ active: false }).where('id', '=', f.bay2).execute();
    try {
      const res = await http().get(`/dealerships/${f.dealershipId}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        id: f.dealershipId,
        name: 'Test site',
        timezone: 'Europe/London',
        bufferMinutes: 15,
        openingHours: [
          ...[1, 2, 3, 4, 5].map((d) => ({
            dayOfWeek: d,
            opensLocal: '08:00',
            closesLocal: '18:00',
          })),
          { dayOfWeek: 6, opensLocal: '08:00', closesLocal: '13:00' },
        ],
        serviceBays: [
          { id: f.bay1, name: 'Bay 1', active: true },
          { id: f.bay2, name: 'Bay 2', active: false },
        ],
        technicians: [
          {
            id: f.tech1,
            name: 'Tech 1',
            active: true,
            skills: [
              { code: 'full_service', name: 'Full service' },
              { code: 'mot', name: 'MOT' },
            ],
          },
          { id: f.tech2, name: 'Tech 2', active: true, skills: [{ code: 'mot', name: 'MOT' }] },
        ],
        serviceTypes: [
          {
            id: f.fullServiceTypeId,
            code: 'full_service',
            name: 'Full service',
            durationMinutes: 90,
            requiredSkillCode: 'full_service',
          },
          {
            id: f.serviceTypeId,
            code: 'mot',
            name: 'MOT',
            durationMinutes: 60,
            requiredSkillCode: 'mot',
          },
        ],
      });
    } finally {
      await db.updateTable('service_bays').set({ active: true }).where('id', '=', f.bay2).execute();
    }
  });

  it('unknown id → 404 in the standard error shape', async () => {
    const id = randomUUID();
    const res = await http().get(`/dealerships/${id}`);
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      error: 'Not Found',
      message: `Dealership ${id} was not found.`,
    });
    expect(res.body.requestId).toBeTruthy();
  });

  it('non-UUID id → 400', async () => {
    const res = await http().get('/dealerships/not-a-uuid');
    expect(res.status).toBe(400);
    expect(res.body.message).toBe('Validation failed (uuid is expected)');
  });
});
