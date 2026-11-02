import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { migrateToLatest } from './db/migrator';
import { loadConfig } from './platform/config';
import { configureHttp } from './platform/http-setup';
import { setupSwagger } from './platform/swagger';

async function bootstrap() {
  const config = loadConfig();
  // Design: forward-only Kysely migrations are applied at startup, before the server listens. Seed is never run here.
  await migrateToLatest(config.databaseUrl, (m) =>
    console.log(JSON.stringify({ level: 30, msg: m })),
  );
  // bodyParser: false — configureHttp registers the JSON parser itself, after the request-id
  // middleware, so parse errors (400/413) still carry a request id.
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(config), {
    bufferLogs: true,
    bodyParser: false,
  });
  configureHttp(app); // x-powered-by off, request id, helmet, JSON body parser
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();
  // Swagger UI is on by default outside production (SWAGGER_ENABLED, see config.ts).
  if (config.swaggerEnabled) setupSwagger(app);
  await app.listen(config.port);
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
