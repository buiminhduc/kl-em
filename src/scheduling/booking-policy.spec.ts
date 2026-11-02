import type { Dealership } from '../directory/directory.types';
import { BookingPolicy } from './booking-policy';
import { BookingRuleError } from './errors';

const northbridge: Dealership = {
  id: 'd1',
  timezone: 'Europe/London',
  bufferMinutes: 15,
  hours: [
    ...[1, 2, 3, 4, 5].map((d) => ({
      dayOfWeek: d,
      opensLocal: '08:00:00',
      closesLocal: '18:00:00',
    })),
    { dayOfWeek: 6, opensLocal: '08:00:00', closesLocal: '13:00:00' },
  ],
};
const mot = { id: 'mot', durationMinutes: 60, requiredSkillCode: 'mot' };
const fullService = { id: 'fs', durationMinutes: 90, requiredSkillCode: 'full_service' };

describe('BookingPolicy', () => {
  const p = new BookingPolicy();
  const at = (iso: string, st = mot) => p.window(st, new Date(iso), northbridge);

  it('end = start + duration; blocked_until = end + 15-minute buffer', () => {
    const w = at('2030-01-07T09:00:00Z');
    expect(w.endAt.toISOString()).toBe('2030-01-07T10:00:00.000Z');
    expect(w.blockedUntil.toISOString()).toBe('2030-01-07T10:15:00.000Z');
    expect(w.bufferMinutes).toBe(15);
  });

  it('accepts a 60-minute job at 17:00 (buffer runs past the 18:00 close)', () => {
    expect(() => p.assertWithinOpeningHours(at('2030-01-07T17:00:00Z'), northbridge)).not.toThrow();
  });

  it('rejects a 90-minute job at 17:00 (the work itself ends at 18:30)', () => {
    expect(() =>
      p.assertWithinOpeningHours(at('2030-01-07T17:00:00Z', fullService), northbridge),
    ).toThrow(BookingRuleError);
  });

  it('rejects Sunday (no hours row) and before opening', () => {
    expect(() => p.assertWithinOpeningHours(at('2030-01-06T10:00:00Z'), northbridge)).toThrow(
      BookingRuleError,
    );
    expect(() => p.assertWithinOpeningHours(at('2030-01-07T07:30:00Z'), northbridge)).toThrow(
      BookingRuleError,
    );
  });

  it('uses the dealership timezone across BST: 08:00Z on 1 Apr 2030 is 09:00 London time', () => {
    // British Summer Time (UTC+1) started 31 Mar 2030. 07:30Z is 08:30 local: open.
    expect(() => p.assertWithinOpeningHours(at('2030-04-01T07:30:00Z'), northbridge)).not.toThrow();
    // 16:30Z is 17:30 local; a 60-minute job would end 18:30 local: closed.
    expect(() => p.assertWithinOpeningHours(at('2030-04-01T16:30:00Z'), northbridge)).toThrow(
      BookingRuleError,
    );
  });

  it('allows one minute of clock skew in the past, not more', () => {
    const now = new Date('2030-01-07T09:00:00Z');
    expect(() => p.assertNotInPast(new Date('2030-01-07T08:59:30Z'), now)).not.toThrow();
    expect(() => p.assertNotInPast(new Date('2030-01-07T08:58:00Z'), now)).toThrow(
      BookingRuleError,
    );
  });
});
