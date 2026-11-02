/**
 * Small fixture built by the tests (not the demo seed): one Europe/London dealership with a 15-min buffer,
 * Mon-Fri 08:00-18:00 and Sat 08:00-13:00; two bays; tech1 (full_service, mot) and tech2 (mot);
 * MOT 60 min and full service 90 min; one customer with three vehicles (more via addVehicles).
 */
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import type { Database } from '../../src/db/types';

export interface Fixture {
  dealershipId: string;
  bay1: string;
  bay2: string;
  tech1: string;
  tech2: string;
  customerId: string;
  vehicle1: string;
  vehicle2: string;
  vehicle3: string;
  serviceTypeId: string; // MOT, 60 minutes
  fullServiceTypeId: string; // full service, 90 minutes, only tech1 qualifies
}

export async function resetAndBuild(db: Kysely<Database>): Promise<Fixture> {
  await sql`TRUNCATE appointments, vehicles, customers, technician_skills, technicians, service_bays,
            service_types, skills, dealership_hours, dealerships`.execute(db);
  const f: Fixture = {
    dealershipId: randomUUID(),
    bay1: randomUUID(),
    bay2: randomUUID(),
    tech1: randomUUID(),
    tech2: randomUUID(),
    customerId: randomUUID(),
    vehicle1: randomUUID(),
    vehicle2: randomUUID(),
    vehicle3: randomUUID(),
    serviceTypeId: randomUUID(),
    fullServiceTypeId: randomUUID(),
  };
  await db
    .insertInto('dealerships')
    .values({
      id: f.dealershipId,
      name: 'Test site',
      timezone: 'Europe/London',
      buffer_minutes: 15,
    })
    .execute();
  await db
    .insertInto('service_bays')
    .values([
      { id: f.bay1, dealership_id: f.dealershipId, name: 'Bay 1' },
      { id: f.bay2, dealership_id: f.dealershipId, name: 'Bay 2' },
    ])
    .execute();
  await db
    .insertInto('dealership_hours')
    .values([
      ...[1, 2, 3, 4, 5].map((d) => ({
        dealership_id: f.dealershipId,
        day_of_week: d,
        opens_local: '08:00',
        closes_local: '18:00',
      })),
      {
        dealership_id: f.dealershipId,
        day_of_week: 6,
        opens_local: '08:00',
        closes_local: '13:00',
      },
    ])
    .execute();
  await db
    .insertInto('skills')
    .values([
      { code: 'mot', name: 'MOT' },
      { code: 'full_service', name: 'Full service' },
    ])
    .execute();
  await db
    .insertInto('technicians')
    .values([
      { id: f.tech1, dealership_id: f.dealershipId, name: 'Tech 1' },
      { id: f.tech2, dealership_id: f.dealershipId, name: 'Tech 2' },
    ])
    .execute();
  await db
    .insertInto('service_types')
    .values([
      {
        id: f.serviceTypeId,
        code: 'mot',
        name: 'MOT',
        duration_minutes: 60,
        required_skill_code: 'mot',
      },
      {
        id: f.fullServiceTypeId,
        code: 'full_service',
        name: 'Full service',
        duration_minutes: 90,
        required_skill_code: 'full_service',
      },
    ])
    .execute();
  await db
    .insertInto('technician_skills')
    .values([
      { technician_id: f.tech1, skill_code: 'full_service' },
      { technician_id: f.tech1, skill_code: 'mot' },
      { technician_id: f.tech2, skill_code: 'mot' },
    ])
    .execute();
  await db
    .insertInto('customers')
    .values({ id: f.customerId, name: 'Test customer', email: null, phone: null })
    .execute();
  await db
    .insertInto('vehicles')
    .values([
      {
        id: f.vehicle1,
        customer_id: f.customerId,
        vin: 'VIN-1',
        make: 'VW',
        model: 'Golf',
        year: 2019,
      },
      {
        id: f.vehicle2,
        customer_id: f.customerId,
        vin: 'VIN-2',
        make: 'VW',
        model: 'Polo',
        year: 2020,
      },
      {
        id: f.vehicle3,
        customer_id: f.customerId,
        vin: 'VIN-3',
        make: 'VW',
        model: 'Up',
        year: 2021,
      },
    ])
    .execute();
  return f;
}

const BUFFER_MS = 15 * 60_000;

/** Inserts an appointment row directly (no booking API yet). end = start + 60 min, blocked_until = end + 15 min. */
export function insertAppointment(
  db: Kysely<Database>,
  f: Fixture,
  p: { bay: string; tech: string; vehicle: string; start: string; blockedUntil?: string },
) {
  const start = new Date(p.start);
  const end = new Date(start.getTime() + 60 * 60_000);
  return db
    .insertInto('appointments')
    .values({
      dealership_id: f.dealershipId,
      customer_id: f.customerId,
      vehicle_id: p.vehicle,
      service_type_id: f.serviceTypeId,
      technician_id: p.tech,
      bay_id: p.bay,
      start_at: start,
      end_at: end,
      buffer_minutes: 15,
      blocked_until: p.blockedUntil
        ? new Date(p.blockedUntil)
        : new Date(end.getTime() + BUFFER_MS),
      preferred_technician_id: null,
      idempotency_key: null,
      idempotency_request_hash: null,
      cancelled_at: null,
    })
    .returning(['id', 'blocked_until'])
    .executeTakeFirstOrThrow();
}

/** Adds n vehicles for the fixture customer (used by the concurrency test). */
export async function addVehicles(db: Kysely<Database>, f: Fixture, n: number): Promise<string[]> {
  const ids = Array.from({ length: n }, () => randomUUID());
  await db
    .insertInto('vehicles')
    .values(
      ids.map((id, i) => ({
        id,
        customer_id: f.customerId,
        vin: `VIN-P${i}`,
        make: 'VW',
        model: 'Golf',
        year: 2022,
      })),
    )
    .execute();
  return ids;
}
