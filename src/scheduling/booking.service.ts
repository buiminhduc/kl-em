import { Injectable } from '@nestjs/common';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { DirectoryReader } from '../directory/directory-reader';
import { AppointmentRepository } from './appointment-repository';
import { BookingHooks } from './booking-hooks';
import { CandidateFinder } from './candidate-finder';
import { CandidateSelector } from './candidate-selector';
import {
  BookingRuleError,
  IdempotencyKeyMismatchError,
  IdempotencyKeyTakenError,
  InsertDeadlockError,
  NoSlotAvailableError,
  NotFoundError,
  SlotUnavailableError,
} from './errors';
import { bookingRequestHash } from './request-hash';
import { AppointmentRow, BookCommand, BookingResult, preferenceHonored } from './scheduling.types';

/** Design: at most three INSERT attempts per booking, then 409. */
export const MAX_INSERT_ATTEMPTS = 3;

/**
 * Optimistic booking: read free pairs, INSERT the best one, and let the Postgres exclusion
 * constraints decide races. On 23P01 (exclusion_violation) drop the taken resource and try the next
 * pair; no locks are held between attempts.
 */
@Injectable()
export class BookingService {
  constructor(
    private readonly directory: DirectoryReader,
    private readonly finder: CandidateFinder,
    private readonly selector: CandidateSelector,
    private readonly repository: AppointmentRepository,
    private readonly hooks: BookingHooks,
    @InjectPinoLogger(BookingService.name) private readonly logger: PinoLogger,
  ) {}

  async book(cmd: BookCommand, now: Date = new Date()): Promise<BookingResult> {
    const requestHash = bookingRequestHash(cmd);

    // A replay of a committed booking returns it before any other work (200, same body).
    if (cmd.idempotencyKey) {
      const existing = await this.repository.findByIdempotencyKey(cmd.idempotencyKey);
      if (existing) return this.replay(existing, requestHash);
    }

    if (!(await this.directory.customerExists(cmd.customerId))) {
      throw new NotFoundError('Customer', cmd.customerId);
    }
    const vehicle = await this.directory.getVehicle(cmd.vehicleId);
    if (!vehicle) throw new NotFoundError('Vehicle', cmd.vehicleId);
    if (vehicle.customerId !== cmd.customerId) {
      throw new BookingRuleError('The vehicle does not belong to this customer.');
    }

    // Shared with GET /availability: 404s, past/opening-hours rules, window, ranked free pairs.
    const { dealership, serviceType, window, candidates } = await this.finder.find(cmd, now);
    let remaining = candidates;
    await this.hooks.afterCandidatesSelected(remaining, window);

    for (let attempt = 1; attempt <= MAX_INSERT_ATTEMPTS && remaining.length > 0; attempt++) {
      const pair = remaining[0];
      try {
        const row = await this.repository.insert({
          dealership_id: dealership.id,
          customer_id: cmd.customerId,
          vehicle_id: cmd.vehicleId,
          service_type_id: serviceType.id,
          technician_id: pair.technicianId,
          bay_id: pair.bayId,
          start_at: window.startAt,
          end_at: window.endAt,
          buffer_minutes: window.bufferMinutes,
          blocked_until: window.blockedUntil,
          preferred_technician_id: cmd.preferredTechnicianId,
          idempotency_key: cmd.idempotencyKey,
          idempotency_request_hash: cmd.idempotencyKey ? requestHash : null,
          cancelled_at: null,
        });
        this.logger.info(
          {
            outcome: 'booked',
            attempt,
            appointmentId: row.id,
            bayId: pair.bayId,
            technicianId: pair.technicianId,
            preferenceHonored: preferenceHonored(row),
          },
          'booking committed',
        );
        return { appointment: row, replayed: false };
      } catch (err) {
        if (err instanceof IdempotencyKeyTakenError) {
          // Same key committed by a concurrent request: same body → replay, different body → 409.
          return this.replay(await this.mustFindByKey(cmd.idempotencyKey!), requestHash);
        }
        if (err instanceof InsertDeadlockError) {
          // Deadlock victim of a concurrent overlapping insert: nothing was written and we do not
          // know which resource clashed, so retry the same pair (still within MAX_INSERT_ATTEMPTS).
          this.logger.info(
            { outcome: 'retry', attempt, reason: 'deadlock' },
            'insert was a deadlock victim (40P01), retrying',
          );
          continue;
        }
        if (!(err instanceof SlotUnavailableError)) throw err;
        if (cmd.idempotencyKey) {
          // A retry of this same request may have won the race: answer with its row, not a 409.
          const mine = await this.repository.findByIdempotencyKey(cmd.idempotencyKey);
          if (mine) return this.replay(mine, requestHash);
        }
        this.logger.info(
          {
            outcome: 'retry',
            attempt,
            bayId: pair.bayId,
            technicianId: pair.technicianId,
            constraint: err.constraint,
          },
          'insert lost the race (23P01 exclusion_violation), trying next pair',
        );
        remaining = this.selector.dropTaken(remaining, pair, err.resource);
      }
    }

    this.logger.info({ outcome: 'conflict' }, 'no free pair left');
    throw new NoSlotAvailableError();
  }

  /**
   * PATCH /appointments/:id/cancel. confirmed → cancelled with cancelled_at = now(). The exclusion
   * constraints ignore cancelled rows, so the slot (tail included) is free at once. Cancelling again
   * returns the same row unchanged (200, cancelledAt not moved). Unknown id → 404.
   */
  async cancel(id: string): Promise<AppointmentRow> {
    const cancelled = await this.repository.markCancelled(id);
    if (cancelled) {
      this.logger.info({ outcome: 'cancelled', appointmentId: id }, 'appointment cancelled');
      return cancelled;
    }
    const existing = await this.repository.findById(id);
    if (!existing) throw new NotFoundError('Appointment', id);
    return existing; // already cancelled: idempotent
  }

  async getById(id: string): Promise<AppointmentRow> {
    const row = await this.repository.findById(id);
    if (!row) throw new NotFoundError('Appointment', id);
    return row;
  }

  private replay(existing: AppointmentRow, requestHash: string): BookingResult {
    if (existing.idempotency_request_hash !== requestHash) throw new IdempotencyKeyMismatchError();
    return { appointment: existing, replayed: true };
  }

  private async mustFindByKey(key: string): Promise<AppointmentRow> {
    const row = await this.repository.findByIdempotencyKey(key);
    if (!row) throw new Error(`Idempotency key ${key} reported taken but no row found`);
    return row;
  }
}
