import { STATUS_CODES } from 'node:http';

const EXAMPLE_REQUEST_ID = '8f0c2d1a-7b34-4e0a-9c11-6a5d0e8b12f4';

/**
 * Builds named OpenAPI examples of the design's error body for one status code, e.g.
 * errorExamples(409, { noPair: 'No service bay …' }). Shown in Swagger UI's example dropdown.
 */
export function errorExamples(statusCode: number, messages: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(messages).map(([name, message]) => [
      name,
      {
        summary: message,
        value: {
          statusCode,
          error: STATUS_CODES[statusCode],
          message,
          requestId: EXAMPLE_REQUEST_ID,
        },
      },
    ]),
  );
}

/** Example ids from the Northbridge seed (src/db/seed-data.ts), so "Try it out" works on a seeded DB. */
export const EXAMPLE_IDS = {
  dealership: '00000000-0000-4000-8000-000000000001',
  bay1: '00000000-0000-4000-8000-000000000101',
  sam: '00000000-0000-4000-8000-000000000201',
  fullService: '00000000-0000-4000-8000-000000000301',
  customer: '00000000-0000-4000-8000-000000000401',
  vehicle: '00000000-0000-4000-8000-000000000501',
  appointment: '3b9d6c1e-2f4a-4c8e-9a71-5d0b2e6f8c13',
} as const;
