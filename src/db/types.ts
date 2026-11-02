/**
 * Handwritten Kysely table types mirroring src/db/migrations/0001_schema.ts.
 * Generated<T> marks columns with a DB default (optional on insert).
 */
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface DealershipsTable {
  id: Generated<string>;
  name: string;
  timezone: string;
  buffer_minutes: Generated<number>;
}

export interface DealershipHoursTable {
  dealership_id: string;
  day_of_week: number; // ISO: Monday = 1 ... Sunday = 7
  opens_local: string; // 'HH:MM:SS', local wall time
  closes_local: string;
}

export interface ServiceBaysTable {
  id: Generated<string>;
  dealership_id: string;
  name: string;
  active: Generated<boolean>;
}

export interface TechniciansTable {
  id: Generated<string>;
  dealership_id: string;
  name: string;
  active: Generated<boolean>;
}

export interface SkillsTable {
  code: string;
  name: string;
}

export interface TechnicianSkillsTable {
  technician_id: string;
  skill_code: string;
}

export interface ServiceTypesTable {
  id: Generated<string>;
  code: string;
  name: string;
  duration_minutes: number;
  required_skill_code: string;
}

export interface CustomersTable {
  id: Generated<string>;
  name: string;
  email: string | null;
  phone: string | null;
}

export interface VehiclesTable {
  id: Generated<string>;
  customer_id: string;
  vin: string;
  make: string;
  model: string;
  year: number;
}

export type AppointmentStatus = 'confirmed' | 'cancelled';

export interface AppointmentsTable {
  id: Generated<string>;
  dealership_id: string;
  customer_id: string;
  vehicle_id: string;
  service_type_id: string;
  technician_id: string;
  bay_id: string;
  start_at: Timestamp;
  end_at: Timestamp;
  buffer_minutes: number;
  blocked_until: Timestamp;
  preferred_technician_id: string | null;
  status: Generated<AppointmentStatus>;
  idempotency_key: string | null;
  idempotency_request_hash: string | null;
  created_at: ColumnType<Date, Date | string | undefined, Date | string>; // DB default now()
  cancelled_at: Timestamp | null;
}

export interface Database {
  dealerships: DealershipsTable;
  dealership_hours: DealershipHoursTable;
  service_bays: ServiceBaysTable;
  technicians: TechniciansTable;
  skills: SkillsTable;
  technician_skills: TechnicianSkillsTable;
  service_types: ServiceTypesTable;
  customers: CustomersTable;
  vehicles: VehiclesTable;
  appointments: AppointmentsTable;
}
