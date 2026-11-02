import { resolveRequestId } from './request-id';

describe('resolveRequestId', () => {
  it('keeps a well-formed inbound id', () => {
    expect(resolveRequestId('abc-123_X')).toBe('abc-123_X');
  });
  it('replaces a malformed or oversized id with a UUID', () => {
    expect(resolveRequestId('bad id!')).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId('a'.repeat(65))).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
});
