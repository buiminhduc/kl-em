/**
 * Runs the Kysely migrations in src/db/migrations (dist/db/migrations after build) with Kysely's native
 * Migrator + FileMigrationProvider. Kysely records applied migrations in kysely_migration and takes its own
 * lock (kysely_migration_lock), so two app replicas starting together do not migrate twice.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type { Kysely } from 'kysely';
// Kysely 0.29 moved the migration API to the 'kysely/migration' subpath export.
import { FileMigrationProvider, Migrator } from 'kysely/migration';
import { createDb } from './database';
import type { Database } from './types';

const MIGRATION_FOLDER = path.join(__dirname, 'migrations');

export function createMigrator(db: Kysely<Database>): Migrator {
  return new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: MIGRATION_FOLDER,
      // Load through this module's own loader instead of Kysely's native import(): this file compiles to
      // CommonJS, so the call becomes require(), which works for .ts under ts-node and ts-jest
      // (Jest --experimental-vm-modules) and for .js in dist.
      import: (file: string) => import(file),
    }),
  });
}

/** Migrates to latest. Throws if any migration fails (Kysely rolls back that migration's transaction). */
export async function migrateToLatest(
  connectionString: string,
  log: (message: string) => void = () => {},
): Promise<string[]> {
  const db = createDb(connectionString, 1);
  try {
    const { error, results } = await createMigrator(db).migrateToLatest();
    for (const r of results ?? []) log(`migration ${r.migrationName}: ${r.status}`);
    if (error) throw error instanceof Error ? error : new Error(String(error));
    return (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName);
  } finally {
    await db.destroy();
  }
}
