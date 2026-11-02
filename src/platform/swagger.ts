import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

/** OpenAPI (Swagger) UI at /docs. The raw JSON/YAML spec endpoints are disabled (raw: false). */
export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('Unified Service Scheduler API')
    .setDescription(
      'Keyloop Scenario A: book a service bay and a qualified technician for the whole job, without double booking. ' +
        'Every booking holds bay, technician and vehicle for the work plus the dealership turnaround buffer (15 min at Northbridge). ' +
        'Double booking is prevented by Postgres exclusion constraints; errors use {statusCode, error, message, requestId}. ' +
        'Example ids are from the Northbridge seed (npm run db:seed). Design: docs/system-design.md.',
    )
    .addTag('appointments', 'Book, fetch and cancel appointments')
    .addTag('availability', 'Read-only check of a proposed start time; nothing is held')
    .addTag('health', 'Liveness and readiness')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('docs', app, document, { raw: false });
}
