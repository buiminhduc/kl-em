import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Kysely } from 'kysely';
import { createDb } from '../db/database';
import type { Database } from '../db/types';
import { APP_CONFIG, AppConfig } from './config';

/** Single Kysely client (pg pool) shared by all modules. */
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly db: Kysely<Database>;
  private readonly logger = new Logger(DatabaseService.name);

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    // A dropped idle connection (e.g. Postgres restart) is logged at warn instead of crashing the
    // process; /health reports 503 until the database is back, then requests recover by themselves.
    this.db = createDb(config.databaseUrl, 10, (err) =>
      this.logger.warn(`postgres idle client error: ${err.message}`),
    );
  }

  async onModuleDestroy() {
    await this.db.destroy();
  }
}
