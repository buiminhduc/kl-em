import 'dotenv/config';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';

describe('GET /health', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const config = {
      databaseUrl: process.env.TEST_DATABASE_URL!,
      port: 0,
      logLevel: 'silent',
      swaggerEnabled: false,
    };
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.forRoot(config)],
    }).compile();
    app = moduleRef.createNestApplication();
    // Listen once on an ephemeral loopback port. Without this, supertest starts and stops its own
    // listener on the un-started server around every batch of requests; with 20 requests in flight
    // at once that lifecycle could leave a request waiting forever (test timeout, then app.close()
    // hanging in afterAll on the still-open connection).
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
  });

  it('returns ok and echoes a valid X-Request-Id', async () => {
    const res = await request(app.getHttpServer()).get('/health').set('X-Request-Id', 'req-123');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toBe('req-123');
  });
});
