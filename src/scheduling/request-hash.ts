import { createHash } from 'node:crypto';

export interface HashedBookingFields {
  dealershipId: string;
  customerId: string;
  vehicleId: string;
  serviceTypeId: string;
  startAt: Date;
  preferredTechnicianId: string | null;
}

/**
 * SHA-256 of the canonical JSON body (design: Retry and idempotency policy). Keys are sorted,
 * preferredTechnicianId is null when omitted, and startAt is normalised to UTC ISO so
 * "09:00:00Z" and "09:00:00+00:00" count as the same request.
 */
export function bookingRequestHash(f: HashedBookingFields): string {
  const canonical = {
    customerId: f.customerId,
    dealershipId: f.dealershipId,
    preferredTechnicianId: f.preferredTechnicianId,
    serviceTypeId: f.serviceTypeId,
    startAt: f.startAt.toISOString(),
    vehicleId: f.vehicleId,
  };
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
