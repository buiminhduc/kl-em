import type { Selectable } from 'kysely';
import type { AppointmentsTable } from '../db/types';

export type AppointmentRow = Selectable<AppointmentsTable>;

/** The booking window. Work is [startAt, endAt); resources are held for [startAt, blockedUntil). */
export interface BookingWindow {
  startAt: Date;
  endAt: Date;
  blockedUntil: Date;
  bufferMinutes: number;
  durationMinutes: number;
}

/** One (bay, technician) pair the booking loop may try to insert. */
export interface Candidate {
  bayId: string;
  technicianId: string;
}

export interface BookCommand {
  dealershipId: string;
  customerId: string;
  vehicleId: string;
  serviceTypeId: string;
  startAt: Date;
  preferredTechnicianId: string | null;
  idempotencyKey: string | null;
}

export interface BookingResult {
  appointment: AppointmentRow;
  /** true when an Idempotency-Key replay returned an already committed appointment (HTTP 200, not 201). */
  replayed: boolean;
}

/** preferenceHonored as the design defines it: derived from the stored row, so a replay returns the same value. */
export function preferenceHonored(row: AppointmentRow): boolean | null {
  if (row.preferred_technician_id === null) return null;
  return row.preferred_technician_id === row.technician_id;
}
