/**
 * HTTP hardening, using the same Express setup as main.ts (bodyParser: false + configureHttp):
 * request id on body-parse errors, generic parse/size messages, security headers.
 */
import 'dotenv/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../../src/app.module';
import { configureHttp } from '../../src/platform/http-setup';

describe('HTTP hardening', () => {
  let app: NestExpressApplication;
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
    app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
    configureHttp(app);
    // Listen once on an ephemeral loopback port. Without this, supertest starts and stops its own
    // listener on the un-started server around every batch of requests; with 20 requests in flight
    // at once that lifecycle could leave a request waiting forever (test timeout, then app.close()
    // hanging in afterAll on the still-open connection).
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
  });

  const post = (body: string) =>
    request(app.getHttpServer())
      .post('/appointments')
      .set('Content-Type', 'application/json')
      .send(body);

  it('malformed JSON → 400 "Malformed JSON body" with a request id in body and header', async () => {
    const res = await post('{"dealershipId":');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      statusCode: 400,
      error: 'Bad Request',
      message: 'Malformed JSON body',
    });
    expect(res.body.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('keeps a valid inbound X-Request-Id on a parse error', async () => {
    const res = await post('{').set('X-Request-Id', 'parse-err-1');
    expect(res.body.requestId).toBe('parse-err-1');
    expect(res.headers['x-request-id']).toBe('parse-err-1');
  });

  it('body over the 100 kB limit → 413 with a generic message and a request id', async () => {
    const res = await post(JSON.stringify({ x: 'a'.repeat(200_000) }));
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ statusCode: 413, message: 'Request body too large' });
    expect(res.body.requestId).not.toBe('');
    expect(res.headers['x-request-id']).toBe(res.body.requestId);
  });

  it('sends security headers and no X-Powered-By', async () => {
    const res = await request(app.getHttpServer()).get('/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
});
