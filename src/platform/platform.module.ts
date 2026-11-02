import { DynamicModule, Global, Module, ValidationPipe } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { APP_CONFIG, AppConfig } from './config';
import { DatabaseService } from './database.provider';
import { HealthController } from './health.controller';
import { HttpExceptionFilter } from './http-exception.filter';
import { REQUEST_ID_HEADER, requestIdFor } from './request-id';

/** Platform: config, Kysely client, pino JSON logs with request id, GET /health. */
@Global()
@Module({})
export class PlatformModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: PlatformModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: config.logLevel,
            // Reuse the id assigned by the first middleware (http-setup.ts); fall back for test apps
            // created without configureHttp.
            genReqId: (req, res) => {
              const existing = (req as { id?: unknown }).id;
              if (typeof existing === 'string' && existing) return existing;
              const id = requestIdFor(req);
              res.setHeader(REQUEST_ID_HEADER, id); // echoed on every response, errors included
              return id;
            },
            customProps: (req) => ({ requestId: req.id }),
            // For 5xx responses pino-http attaches a synthetic "failed with status code …" error with a
            // stack trace. The exception filter already logs the real error at the right level, so the
            // access-log line keeps only status and timing.
            customErrorObject: (_req, _res, _err, loggable) => {
              const rest = { ...(loggable as Record<string, unknown>) };
              delete rest.err;
              return rest;
            },
            customErrorMessage: (_req, res) => `request failed with status ${res.statusCode}`,
            // Logs carry ids, not personal data: keep request logging to method/url/status.
            serializers: {
              req: (req) => ({ id: req.id, method: req.method, url: req.url }),
              res: (res) => ({ statusCode: res.statusCode }),
            },
          },
        }),
      ],
      controllers: [HealthController],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        DatabaseService,
        // Global request validation (class-validator DTOs). Unknown fields are rejected with 400.
        {
          provide: APP_PIPE,
          useValue: new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true }),
        },
        // Every error leaves in the design's error body, with the request id.
        { provide: APP_FILTER, useClass: HttpExceptionFilter },
      ],
      exports: [APP_CONFIG, DatabaseService],
    };
  }
}
