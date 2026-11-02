/**
 * Unit tests for the retry loop with fake collaborators (no database). The fake repository's
 * insert() throws SlotUnavailableError the way the real one does on Postgres 23P01.
 */
import type { Dealership } from '../directory/directory.types';
import { BookingHooks } from './booking-hooks';
import { BookingPolicy } from './booking-policy';
import { BookingService, MAX_INSERT_ATTEMPTS } from './booking.service';
import { CandidateFinder } from './candidate-finder';
import { CandidateSelector } from './candidate-selector';
import {
  IdempotencyKeyMismatchError,
  InsertDeadlockError,
  NoSlotAvailableError,
  SlotUnavailableError,
} from './errors';
import { bookingRequestHash } from './request-hash';
import type { AppointmentRow, BookCommand } from './scheduling.types';

const dealership: Dealership = {
  id: 'd1',
  timezone: 'Europe/London',
  bufferMinutes: 15,
  hours: [{ dayOfWeek: 1, opensLocal: '08:00:00', closesLocal: '18:00:00' }],
};

const directory = {
  getDealership: async () => dealership,
  getServiceType: async () => ({ id: 'mot', durationMinutes: 60, requiredSkillCode: 'mot' }),
  customerExists: async () => true,
  getVehicle: async () => ({ id: 'v1', customerId: 'c1' }),
  getTechnician: async (id: string) => ({ id, dealershipId: 'd1', active: true }),
};

const cmd: BookCommand = {
  dealershipId: 'd1',
  customerId: 'c1',
  vehicleId: 'v1',
  serviceTypeId: 'mot',
  startAt: new Date('2030-01-07T09:00:00Z'), // a Monday
  preferredTechnicianId: null,
  idempotencyKey: null,
};
const now = new Date('2030-01-01T00:00:00Z');

function rowFrom(values: Record<string, unknown>): AppointmentRow {
  return { id: 'a1', status: 'confirmed', created_at: now, ...values } as unknown as AppointmentRow;
}

function makeService(opts: {
  bays: string[];
  techs: string[];
  failures: Array<SlotUnavailableError | InsertDeadlockError>;
  byKey?: AppointmentRow;
}) {
  const inserts: Array<{ bay_id: string; technician_id: string }> = [];
  const repo = {
    findByIdempotencyKey: async () => opts.byKey,
    findFreeBays: async () => opts.bays,
    findFreeTechnicians: async () => opts.techs,
    insert: async (values: Record<string, unknown>) => {
      inserts.push(values as { bay_id: string; technician_id: string });
      const failure = opts.failures.shift();
      if (failure) throw failure;
      return rowFrom(values);
    },
  };
  const logger = { info: () => undefined };
  const selector = new CandidateSelector();
  const finder = new CandidateFinder(
    directory as never,
    new BookingPolicy(),
    selector,
    repo as never,
  );
  const service = new BookingService(
    directory as never,
    finder,
    selector,
    repo as never,
    new BookingHooks(),
    logger as never,
  );
  return { service, inserts };
}

const bayTaken = () => new SlotUnavailableError('bay', 'appointments_bay_no_overlap');
const techTaken = () =>
  new SlotUnavailableError('technician', 'appointments_technician_no_overlap');

describe('BookingService retry loop', () => {
  it('retries the next pair after a 23P01 on the bay and commits it', async () => {
    const { service, inserts } = makeService({
      bays: ['b1', 'b2'],
      techs: ['t1'],
      failures: [bayTaken()],
    });
    const result = await service.book(cmd, now);
    expect(inserts.map((i) => i.bay_id)).toEqual(['b1', 'b2']);
    expect(result.appointment.bay_id).toBe('b2');
  });

  it('a 40P01 deadlock victim retries the same pair and commits it', async () => {
    const { service, inserts } = makeService({
      bays: ['b1', 'b2'],
      techs: ['t1'],
      failures: [new InsertDeadlockError()],
    });
    const result = await service.book(cmd, now);
    expect(inserts.map((i) => i.bay_id)).toEqual(['b1', 'b1']);
    expect(result.appointment.bay_id).toBe('b1');
  });

  it(`stops after ${MAX_INSERT_ATTEMPTS} inserts even when pairs remain, then 409`, async () => {
    const { service, inserts } = makeService({
      bays: ['b1', 'b2', 'b3', 'b4'],
      techs: ['t1'],
      failures: [bayTaken(), bayTaken(), bayTaken(), bayTaken()],
    });
    await expect(service.book(cmd, now)).rejects.toBeInstanceOf(NoSlotAvailableError);
    expect(inserts).toHaveLength(MAX_INSERT_ATTEMPTS); // a fourth attempt never runs
  });

  it('a 23P01 on the preferred technician continues with someone else: preferenceHonored false', async () => {
    const { service } = makeService({ bays: ['b1'], techs: ['t1', 't2'], failures: [techTaken()] });
    const result = await service.book({ ...cmd, preferredTechnicianId: 't2' }, now);
    expect(result.appointment.technician_id).toBe('t1');
    expect(result.appointment.preferred_technician_id).toBe('t2'); // stored → preferenceHonored false
  });

  it('409 without inserting when no pair is free', async () => {
    const { service, inserts } = makeService({ bays: [], techs: ['t1'], failures: [] });
    await expect(service.book(cmd, now)).rejects.toBeInstanceOf(NoSlotAvailableError);
    expect(inserts).toHaveLength(0);
  });
});

describe('BookingService idempotency', () => {
  const key = 'key-1';
  it('same key + same body hash → replay of the stored row', async () => {
    const stored = rowFrom({
      idempotency_key: key,
      idempotency_request_hash: bookingRequestHash(cmd),
    });
    const { service, inserts } = makeService({
      bays: ['b1'],
      techs: ['t1'],
      failures: [],
      byKey: stored,
    });
    const result = await service.book({ ...cmd, idempotencyKey: key }, now);
    expect(result).toEqual({ appointment: stored, replayed: true });
    expect(inserts).toHaveLength(0);
  });

  it('same key + different body hash → IdempotencyKeyMismatchError (409)', async () => {
    const stored = rowFrom({ idempotency_key: key, idempotency_request_hash: 'other' });
    const { service } = makeService({ bays: ['b1'], techs: ['t1'], failures: [], byKey: stored });
    await expect(service.book({ ...cmd, idempotencyKey: key }, now)).rejects.toBeInstanceOf(
      IdempotencyKeyMismatchError,
    );
  });

  it('hash ignores the offset spelling of the same instant', () => {
    expect(bookingRequestHash({ ...cmd, startAt: new Date('2030-01-07T10:00:00+01:00') })).toBe(
      bookingRequestHash(cmd),
    );
  });
});
