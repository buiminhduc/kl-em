/**
 * Loads the Northbridge sample world. Idempotent: every insert is ON CONFLICT DO NOTHING on the
 * fixed ids / unique codes, so rerunning it changes nothing. The app never runs it at startup.
 * Lives in src/ so it is compiled into dist/ and can run inside the container:
 *   local:  npm run db:seed
 *   docker: the one-shot `seed` service in docker-compose.yml runs it on every `up`
 *           (by hand: docker compose run --rm seed)
 */
import 'dotenv/config';
import { createDb } from './database';
import { SEED_IDS as S } from './seed-data';

export async function seed(url: string): Promise<void> {
  const db = createDb(url, 1);
  try {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto('dealerships')
        .values({
          id: S.dealership,
          name: 'Northbridge',
          timezone: 'Europe/London',
          buffer_minutes: 15,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      const hours = [1, 2, 3, 4, 5].map((d) => ({
        dealership_id: S.dealership,
        day_of_week: d,
        opens_local: '08:00',
        closes_local: '18:00',
      }));
      hours.push({
        dealership_id: S.dealership,
        day_of_week: 6,
        opens_local: '08:00',
        closes_local: '13:00',
      });
      // Sunday (7): no row = closed.
      await trx
        .insertInto('dealership_hours')
        .values(hours)
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .insertInto('service_bays')
        .values([
          { id: S.bay1, dealership_id: S.dealership, name: 'Bay 1' },
          { id: S.bay2, dealership_id: S.dealership, name: 'Bay 2' },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .insertInto('skills')
        .values([
          { code: 'full_service', name: 'Full service' },
          { code: 'mot', name: 'MOT' },
          { code: 'diagnostics', name: 'Diagnostics' },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .insertInto('technicians')
        .values([
          { id: S.sam, dealership_id: S.dealership, name: 'Sam' },
          { id: S.priya, dealership_id: S.dealership, name: 'Priya' },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .insertInto('technician_skills')
        .values([
          { technician_id: S.sam, skill_code: 'full_service' },
          { technician_id: S.sam, skill_code: 'mot' },
          { technician_id: S.priya, skill_code: 'mot' },
          { technician_id: S.priya, skill_code: 'diagnostics' },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .insertInto('service_types')
        .values([
          {
            id: S.fullService,
            code: 'full_service',
            name: 'Full service',
            duration_minutes: 90,
            required_skill_code: 'full_service',
          },
          { id: S.mot, code: 'mot', name: 'MOT', duration_minutes: 60, required_skill_code: 'mot' },
          {
            id: S.diagnostics,
            code: 'diagnostics',
            name: 'Diagnostics',
            duration_minutes: 90,
            required_skill_code: 'diagnostics',
          },
        ])
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .insertInto('customers')
        .values({
          id: S.customer,
          name: 'Alex Morgan',
          email: 'alex@example.com',
          phone: '+44 20 7946 0000',
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
      await trx
        .insertInto('vehicles')
        .values({
          id: S.vehicle,
          customer_id: S.customer,
          vin: 'WVWZZZ1KZAW000001',
          make: 'Volkswagen',
          model: 'Golf',
          year: 2019,
        })
        .onConflict((oc) => oc.doNothing())
        .execute();
    });
    console.log('seeded Northbridge sample world');
  } finally {
    await db.destroy();
  }
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  seed(url).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
