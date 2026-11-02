import { Injectable } from '@nestjs/common';
import { DateTime } from 'luxon';
import type { Dealership, ServiceType } from '../directory/directory.types';
import { BookingRuleError } from './errors';
import type { BookingWindow } from './scheduling.types';

const MINUTE_MS = 60_000;
/** Clock-skew allowance: a start up to one minute in the past is still accepted (working assumption 10). */
const PAST_TOLERANCE_MS = MINUTE_MS;

/**
 * Pure booking rules, no database. Window arithmetic and the opening-hours check.
 * Durations and the buffer are absolute minutes added in UTC; opening hours are compared in the
 * dealership's IANA timezone with Luxon, so BST/GMT changes are handled (never a fixed offset).
 */
@Injectable()
export class BookingPolicy {
  /** end_at = start + catalogue duration; blocked_until = end_at + the dealership's current buffer. */
  window(serviceType: ServiceType, startAt: Date, dealership: Dealership): BookingWindow {
    const endAt = new Date(startAt.getTime() + serviceType.durationMinutes * MINUTE_MS);
    const blockedUntil = new Date(endAt.getTime() + dealership.bufferMinutes * MINUTE_MS);
    return {
      startAt,
      endAt,
      blockedUntil,
      bufferMinutes: dealership.bufferMinutes,
      durationMinutes: serviceType.durationMinutes,
    };
  }

  assertNotInPast(startAt: Date, now: Date): void {
    if (startAt.getTime() < now.getTime() - PAST_TOLERANCE_MS) {
      throw new BookingRuleError('startAt is in the past.');
    }
  }

  /**
   * The WORK [startAt, endAt) must sit inside one opening period, in dealership local time.
   * The buffer tail may run past closing. Crossing local midnight or a closed weekday is rejected.
   */
  assertWithinOpeningHours(window: BookingWindow, dealership: Dealership): void {
    const start = DateTime.fromJSDate(window.startAt, { zone: dealership.timezone });
    const end = DateTime.fromJSDate(window.endAt, { zone: dealership.timezone });
    if (start.toISODate() !== end.toISODate()) {
      throw new BookingRuleError('The service must start and finish on the same local day.');
    }
    const period = dealership.hours.find((h) => h.dayOfWeek === start.weekday); // Luxon weekday is ISO 1-7
    if (!period) {
      throw new BookingRuleError('The dealership is closed on that day.');
    }
    const startLocal = start.toFormat('HH:mm:ss');
    const endLocal = end.toFormat('HH:mm:ss');
    const opens = normaliseTime(period.opensLocal);
    const closes = normaliseTime(period.closesLocal);
    if (startLocal < opens || endLocal > closes) {
      throw new BookingRuleError(
        `The service must fit within opening hours (${opens.slice(0, 5)}-${closes.slice(0, 5)} local time).`,
      );
    }
  }
}

/** Postgres returns time as 'HH:MM:SS'; accept 'HH:MM' too so string comparison is safe. */
function normaliseTime(t: string): string {
  return t.length === 5 ? `${t}:00` : t;
}
