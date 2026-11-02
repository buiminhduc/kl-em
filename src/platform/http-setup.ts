import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { REQUEST_ID_HEADER, requestIdFor } from './request-id';

/** JSON body limit. A booking body is well under 1 kB; larger bodies get 413. */
export const JSON_BODY_LIMIT = '100kb';

/**
 * Express-level HTTP setup shared by main.ts and the tests. The app must be created with
 * `{ bodyParser: false }` so that the order below is ours:
 *
 * 1. request id: assigned first, so even a body that fails to parse (400/413) carries
 *    X-Request-Id and a requestId in the error body. pino-http reuses req.id.
 * 2. helmet: security headers (nosniff, frame-ancestors, CSP, …).
 * 3. JSON body parser, registered the Nest way (useBodyParser), after the two above.
 * 4. an Express error middleware that turns body-parser failures into Nest HttpExceptions with
 *    generic messages. Without it Nest's Express adapter maps invalid JSON to
 *    `new BadRequestException(syntaxError.message)`, echoing parser internals such as
 *    "Unexpected token … in JSON at position 7" and dropping the error `type` the filter could use.
 */
export function configureHttp(app: NestExpressApplication): void {
  // Express adds `X-Powered-By: Express` by default; don't advertise the HTTP library.
  app.disable('x-powered-by');

  app.use((req: Request & { id?: string }, res: Response, next: NextFunction) => {
    req.id = requestIdFor(req);
    res.setHeader(REQUEST_ID_HEADER, req.id);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // Swagger UI (/docs) loads only same-origin scripts (bundle, preset, swagger-ui-init.js),
          // so script-src stays 'self' with no 'unsafe-inline'. Its index.html has an inline <style>
          // block, hence 'unsafe-inline' for styles only; its icons are data: URIs.
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
    }),
  );

  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });

  // Express treats a 4-argument middleware as an error handler. body-parser errors carry a `type`:
  // 'entity.parse.failed' = invalid JSON, 'entity.too.large' = over JSON_BODY_LIMIT.
  app.use((err: unknown, _req: Request, _res: Response, next: NextFunction) => {
    const type = (err as { type?: unknown } | undefined)?.type;
    if (type === 'entity.parse.failed') return next(new BadRequestException('Malformed JSON body'));
    if (type === 'entity.too.large') {
      return next(new PayloadTooLargeException('Request body too large'));
    }
    next(err);
  });
}
