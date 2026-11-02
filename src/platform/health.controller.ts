import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { sql } from 'kysely';
import { DatabaseService } from './database.provider';

/** Liveness and readiness for v1: 200 {status: ok} after SELECT 1, 503 when Postgres is unreachable. */
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Liveness and readiness: pings Postgres with SELECT 1' })
  @ApiOkResponse({
    description: 'Database reachable',
    schema: { type: 'object', properties: { status: { type: 'string', example: 'ok' } } },
  })
  @ApiServiceUnavailableResponse({ description: 'Postgres unreachable' })
  async check() {
    try {
      await sql`SELECT 1`.execute(this.database.db);
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException({ status: 'unavailable' });
    }
  }
}
