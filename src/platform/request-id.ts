import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

/** Inbound X-Request-Id is kept when it is 1-64 chars of [A-Za-z0-9_-]; otherwise a UUID is generated. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const REQUEST_ID_HEADER = 'x-request-id';

export function resolveRequestId(inbound: unknown): string {
  return typeof inbound === 'string' && REQUEST_ID_PATTERN.test(inbound) ? inbound : randomUUID();
}

export function requestIdFor(req: IncomingMessage): string {
  return resolveRequestId(req.headers[REQUEST_ID_HEADER]);
}
