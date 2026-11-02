/**
 * Recreates the scheduler_test database on the docker-compose Postgres and applies migrations.
 * Tests build their own fixture; the demo seed is never used here.
 */
import 'dotenv/config';
import { Client } from 'pg';
import { migrateToLatest } from '../../src/db/migrator';

export default async function globalSetup() {
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) throw new Error('TEST_DATABASE_URL is not set (see .env.example)');
  const url = new URL(testUrl);
  const dbName = url.pathname.slice(1);
  if (!/^[a-z_][a-z0-9_]*$/.test(dbName) || !dbName.endsWith('_test')) {
    throw new Error(`Refusing to recreate "${dbName}": test database name must end in _test`);
  }
  const admin = new URL(testUrl);
  admin.pathname = '/postgres';
  const client = new Client({ connectionString: admin.toString() });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
    await client.query(`CREATE DATABASE ${dbName}`);
  } finally {
    await client.end();
  }
  await migrateToLatest(testUrl);
}
