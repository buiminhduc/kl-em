import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../platform/database.provider';
import {
  Dealership,
  DealershipDetail,
  DealershipSummary,
  ServiceType,
  Technician,
  Vehicle,
} from './directory.types';

/** Postgres `time` comes back as 'HH:MM:SS'; the API shows 'HH:MM'. */
const toHhMm = (t: string) => t.slice(0, 5);

/**
 * Read models for reference data. Answers "what exists here?", never "is it free?"
 * (that is AppointmentRepository's job). Methods return undefined for unknown ids; callers decide on 404.
 */
@Injectable()
export class DirectoryReader {
  constructor(private readonly database: DatabaseService) {}

  async getDealership(id: string): Promise<Dealership | undefined> {
    const db = this.database.db;
    const row = await db
      .selectFrom('dealerships')
      .select(['id', 'timezone', 'buffer_minutes'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!row) return undefined;
    const hours = await db
      .selectFrom('dealership_hours')
      .select(['day_of_week', 'opens_local', 'closes_local'])
      .where('dealership_id', '=', id)
      .execute();
    return {
      id: row.id,
      timezone: row.timezone,
      bufferMinutes: row.buffer_minutes,
      hours: hours.map((h) => ({
        dayOfWeek: h.day_of_week,
        opensLocal: h.opens_local,
        closesLocal: h.closes_local,
      })),
    };
  }

  async getServiceType(id: string): Promise<ServiceType | undefined> {
    const row = await this.database.db
      .selectFrom('service_types')
      .select(['id', 'duration_minutes', 'required_skill_code'])
      .where('id', '=', id)
      .executeTakeFirst();
    return (
      row && {
        id: row.id,
        durationMinutes: row.duration_minutes,
        requiredSkillCode: row.required_skill_code,
      }
    );
  }

  async customerExists(id: string): Promise<boolean> {
    const row = await this.database.db
      .selectFrom('customers')
      .select('id')
      .where('id', '=', id)
      .executeTakeFirst();
    return !!row;
  }

  /** Looks up the vehicle by id; the caller checks ownership (wrong owner is 422, unknown id is 404). */
  async getVehicle(id: string): Promise<Vehicle | undefined> {
    const row = await this.database.db
      .selectFrom('vehicles')
      .select(['id', 'customer_id'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row && { id: row.id, customerId: row.customer_id };
  }

  /** Returns the vehicle only when it belongs to the customer (Level 4 sketch: getVehicleForCustomer). */
  async getVehicleForCustomer(customerId: string, vehicleId: string): Promise<Vehicle | undefined> {
    const vehicle = await this.getVehicle(vehicleId);
    return vehicle && vehicle.customerId === customerId ? vehicle : undefined;
  }

  async getTechnician(id: string): Promise<Technician | undefined> {
    const row = await this.database.db
      .selectFrom('technicians')
      .select(['id', 'dealership_id', 'active'])
      .where('id', '=', id)
      .executeTakeFirst();
    return row && { id: row.id, dealershipId: row.dealership_id, active: row.active };
  }

  /** All dealerships, ordered by name. No pagination: the seed has one (see README limitations). */
  async listDealerships(): Promise<DealershipSummary[]> {
    return this.database.db
      .selectFrom('dealerships')
      .select(['id', 'name', 'timezone'])
      .orderBy('name')
      .orderBy('id')
      .execute();
  }

  /**
   * One dealership with opening hours, bays, technicians (with skills) and the service types it can
   * book. Service types are a global catalogue in the schema (no dealership_id), so every type is
   * listed. Inactive bays and technicians are included with active=false. Unknown id → undefined.
   */
  async getDealershipDetail(id: string): Promise<DealershipDetail | undefined> {
    const db = this.database.db;
    const dealership = await db
      .selectFrom('dealerships')
      .select(['id', 'name', 'timezone', 'buffer_minutes'])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!dealership) return undefined;

    const [hours, bays, technicians, skills, serviceTypes] = await Promise.all([
      db
        .selectFrom('dealership_hours')
        .select(['day_of_week', 'opens_local', 'closes_local'])
        .where('dealership_id', '=', id)
        .orderBy('day_of_week')
        .execute(),
      db
        .selectFrom('service_bays')
        .select(['id', 'name', 'active'])
        .where('dealership_id', '=', id)
        .orderBy('name')
        .execute(),
      db
        .selectFrom('technicians')
        .select(['id', 'name', 'active'])
        .where('dealership_id', '=', id)
        .orderBy('name')
        .execute(),
      db
        .selectFrom('technician_skills as ts')
        .innerJoin('technicians as t', 't.id', 'ts.technician_id')
        .innerJoin('skills as s', 's.code', 'ts.skill_code')
        .select(['ts.technician_id', 's.code', 's.name'])
        .where('t.dealership_id', '=', id)
        .orderBy('s.code')
        .execute(),
      db
        .selectFrom('service_types')
        .select(['id', 'code', 'name', 'duration_minutes', 'required_skill_code'])
        .orderBy('name')
        .execute(),
    ]);

    return {
      id: dealership.id,
      name: dealership.name,
      timezone: dealership.timezone,
      bufferMinutes: dealership.buffer_minutes,
      openingHours: hours.map((h) => ({
        dayOfWeek: h.day_of_week,
        opensLocal: toHhMm(h.opens_local),
        closesLocal: toHhMm(h.closes_local),
      })),
      serviceBays: bays,
      technicians: technicians.map((t) => ({
        ...t,
        skills: skills
          .filter((s) => s.technician_id === t.id)
          .map((s) => ({ code: s.code, name: s.name })),
      })),
      serviceTypes: serviceTypes.map((st) => ({
        id: st.id,
        code: st.code,
        name: st.name,
        durationMinutes: st.duration_minutes,
        requiredSkillCode: st.required_skill_code,
      })),
    };
  }
}
