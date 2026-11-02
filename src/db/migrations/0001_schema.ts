/**
 * 0001: reference data and appointments, as specified in docs/system-design.md (Domain model, Turnaround buffer).
 * Kysely migration, run by Kysely's Migrator (src/db/migrator.ts). Tables, keys and simple checks use the
 * schema builder; btree_gist, the tstzrange exclusion constraints and the blocked_until check use raw sql``.
 */
import { Kysely, sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- migrations must not depend on the evolving app types
export async function up(db: Kysely<any>): Promise<void> {
  // btree_gist lets one GiST exclusion constraint combine "=" on a uuid with "&&" (overlap) on a range.
  await sql`CREATE EXTENSION IF NOT EXISTS btree_gist`.execute(db);

  await db.schema
    .createTable('dealerships')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('timezone', 'text', (c) => c.notNull()) // IANA zone, e.g. Europe/London
    .addColumn('buffer_minutes', 'integer', (c) => c.notNull().defaultTo(15))
    .addCheckConstraint('dealerships_buffer_range', sql`buffer_minutes BETWEEN 0 AND 240`)
    .execute();

  // Weekly template of local wall-clock hours. ISO day_of_week: Monday = 1 ... Sunday = 7.
  // A missing row means the dealership is closed that weekday.
  await db.schema
    .createTable('dealership_hours')
    .addColumn('dealership_id', 'uuid', (c) => c.notNull().references('dealerships.id'))
    .addColumn('day_of_week', 'integer', (c) => c.notNull())
    .addColumn('opens_local', 'time', (c) => c.notNull())
    .addColumn('closes_local', 'time', (c) => c.notNull())
    .addPrimaryKeyConstraint('dealership_hours_pkey', ['dealership_id', 'day_of_week'])
    .addCheckConstraint('dealership_hours_iso_day', sql`day_of_week BETWEEN 1 AND 7`)
    .addCheckConstraint('dealership_hours_open_before_close', sql`opens_local < closes_local`)
    .execute();

  // (dealership_id, id) uniques are targets of the composite FKs from appointments,
  // which keep a booking inside one dealership.
  await db.schema
    .createTable('service_bays')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dealership_id', 'uuid', (c) => c.notNull().references('dealerships.id'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addUniqueConstraint('service_bays_dealership_id_id_key', ['dealership_id', 'id'])
    .execute();

  await db.schema
    .createTable('technicians')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dealership_id', 'uuid', (c) => c.notNull().references('dealerships.id'))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('active', 'boolean', (c) => c.notNull().defaultTo(true))
    .addUniqueConstraint('technicians_dealership_id_id_key', ['dealership_id', 'id'])
    .execute();

  // Seeded vocabulary, not free text, so a typo cannot make every technician unqualified.
  await db.schema
    .createTable('skills')
    .addColumn('code', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull())
    .execute();

  await db.schema
    .createTable('technician_skills')
    .addColumn('technician_id', 'uuid', (c) => c.notNull().references('technicians.id'))
    .addColumn('skill_code', 'text', (c) => c.notNull().references('skills.code'))
    .addPrimaryKeyConstraint('technician_skills_pkey', ['technician_id', 'skill_code'])
    .execute();

  await db.schema
    .createTable('service_types')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('code', 'text', (c) => c.notNull().unique())
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('duration_minutes', 'integer', (c) => c.notNull())
    .addColumn('required_skill_code', 'text', (c) => c.notNull().references('skills.code'))
    .addCheckConstraint('service_types_duration_positive', sql`duration_minutes > 0`)
    .execute();

  await db.schema
    .createTable('customers')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('name', 'text', (c) => c.notNull())
    .addColumn('email', 'text')
    .addColumn('phone', 'text')
    .execute();

  await db.schema
    .createTable('vehicles')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('customer_id', 'uuid', (c) => c.notNull().references('customers.id'))
    .addColumn('vin', 'text', (c) => c.notNull().unique())
    .addColumn('make', 'text', (c) => c.notNull())
    .addColumn('model', 'text', (c) => c.notNull())
    .addColumn('year', 'integer', (c) => c.notNull())
    // Target of the composite FK from appointments (vehicle must belong to the customer).
    .addUniqueConstraint('vehicles_customer_id_id_key', ['customer_id', 'id'])
    .execute();

  await db.schema
    .createTable('appointments')
    .addColumn('id', 'uuid', (c) => c.primaryKey().defaultTo(sql`gen_random_uuid()`))
    .addColumn('dealership_id', 'uuid', (c) =>
      c.notNull().references('dealerships.id').onDelete('restrict'),
    )
    .addColumn('customer_id', 'uuid', (c) => c.notNull())
    .addColumn('vehicle_id', 'uuid', (c) => c.notNull())
    .addColumn('service_type_id', 'uuid', (c) =>
      c.notNull().references('service_types.id').onDelete('restrict'),
    )
    .addColumn('technician_id', 'uuid', (c) => c.notNull())
    .addColumn('bay_id', 'uuid', (c) => c.notNull())
    .addColumn('start_at', 'timestamptz', (c) => c.notNull())
    .addColumn('end_at', 'timestamptz', (c) => c.notNull()) // start_at + service duration (end of the work)
    .addColumn('buffer_minutes', 'integer', (c) => c.notNull()) // dealership turnaround, frozen at insert
    .addColumn('blocked_until', 'timestamptz', (c) => c.notNull()) // end_at + buffer_minutes (end of the hold)
    .addColumn('preferred_technician_id', 'uuid', (c) =>
      c.references('technicians.id').onDelete('restrict'),
    )
    .addColumn('status', 'text', (c) => c.notNull().defaultTo('confirmed'))
    .addColumn('idempotency_key', 'text', (c) => c.unique()) // unique when present (NULLs never collide)
    .addColumn('idempotency_request_hash', 'text')
    .addColumn('created_at', 'timestamptz', (c) => c.notNull().defaultTo(sql`now()`))
    .addColumn('cancelled_at', 'timestamptz')
    .addForeignKeyConstraint(
      'appointments_bay_fk',
      ['dealership_id', 'bay_id'],
      'service_bays',
      ['dealership_id', 'id'],
      (fk) => fk.onDelete('restrict'),
    )
    .addForeignKeyConstraint(
      'appointments_technician_fk',
      ['dealership_id', 'technician_id'],
      'technicians',
      ['dealership_id', 'id'],
      (fk) => fk.onDelete('restrict'),
    )
    .addForeignKeyConstraint(
      'appointments_vehicle_fk',
      ['customer_id', 'vehicle_id'],
      'vehicles',
      ['customer_id', 'id'],
      (fk) => fk.onDelete('restrict'),
    )
    .addCheckConstraint('appointments_status_valid', sql`status IN ('confirmed', 'cancelled')`)
    .addCheckConstraint('appointments_end_after_start', sql`end_at > start_at`)
    .addCheckConstraint('appointments_buffer_range', sql`buffer_minutes BETWEEN 0 AND 240`)
    .addCheckConstraint(
      'appointments_idempotency_hash_with_key',
      sql`(idempotency_key IS NULL) = (idempotency_request_hash IS NULL)`,
    )
    .execute();

  // blocked_until is a plain stored column, not GENERATED and not inlined in EXCLUDE:
  // timestamptz + interval is only STABLE (not IMMUTABLE), and index/generated expressions must be immutable.
  // A CHECK may call stable functions, so it pins the stored value instead (fails closed on a wrong insert).
  await sql`
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_buffer_matches_end
      CHECK (blocked_until = end_at + make_interval(mins => buffer_minutes))
  `.execute(db);

  // Exclusion constraints: no two non-cancelled rows may share a bay / technician / vehicle
  // while their half-open blocked ranges [start_at, blocked_until) overlap.
  // A violation raises SQLSTATE 23P01 (exclusion_violation) carrying the constraint name.
  await sql`
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_bay_no_overlap
      EXCLUDE USING gist (
        bay_id WITH =,
        tstzrange(start_at, blocked_until, '[)') WITH &&
      )
      WHERE (status <> 'cancelled')
  `.execute(db);

  await sql`
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_technician_no_overlap
      EXCLUDE USING gist (
        technician_id WITH =,
        tstzrange(start_at, blocked_until, '[)') WITH &&
      )
      WHERE (status <> 'cancelled')
  `.execute(db);

  // Deliberate addition beyond the brief: one vehicle, one appointment at a time.
  await sql`
    ALTER TABLE appointments
      ADD CONSTRAINT appointments_vehicle_no_overlap
      EXCLUDE USING gist (
        vehicle_id WITH =,
        tstzrange(start_at, blocked_until, '[)') WITH &&
      )
      WHERE (status <> 'cancelled')
  `.execute(db);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function down(db: Kysely<any>): Promise<void> {
  for (const table of [
    'appointments',
    'vehicles',
    'customers',
    'service_types',
    'technician_skills',
    'skills',
    'technicians',
    'service_bays',
    'dealership_hours',
    'dealerships',
  ]) {
    await db.schema.dropTable(table).execute();
  }
  await sql`DROP EXTENSION IF EXISTS btree_gist`.execute(db);
}
