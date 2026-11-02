/**
 * The design's "Sample world" (docs/system-design.md): Northbridge, Europe/London,
 * Mon-Fri 08:00-18:00, Sat 08:00-13:00, Sun closed, 15-minute buffer; Bay 1 and Bay 2;
 * Sam (full_service, mot) and Priya (mot, diagnostics); three service types; one customer and vehicle.
 * Fixed UUIDs so API examples and cURL scripts can reference them.
 */
export const SEED_IDS = {
  dealership: '00000000-0000-4000-8000-000000000001',
  bay1: '00000000-0000-4000-8000-000000000101',
  bay2: '00000000-0000-4000-8000-000000000102',
  sam: '00000000-0000-4000-8000-000000000201',
  priya: '00000000-0000-4000-8000-000000000202',
  fullService: '00000000-0000-4000-8000-000000000301',
  mot: '00000000-0000-4000-8000-000000000302',
  diagnostics: '00000000-0000-4000-8000-000000000303',
  customer: '00000000-0000-4000-8000-000000000401',
  vehicle: '00000000-0000-4000-8000-000000000501',
} as const;
