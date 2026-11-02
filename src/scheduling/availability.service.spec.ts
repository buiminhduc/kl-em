/** AvailabilityService with fake repository/directory: same CandidateFinder as booking, no writes. */
import type { Dealership } from '../directory/directory.types';
import { AvailabilityService, AVAILABILITY_CANDIDATE_CAP } from './availability.service';
import { BookingPolicy } from './booking-policy';
import { CandidateFinder } from './candidate-finder';
import { CandidateSelector } from './candidate-selector';
import { BookingRuleError } from './errors';

const dealership: Dealership = {
  id: 'd1',
  timezone: 'Europe/London',
  bufferMinutes: 15,
  hours: [{ dayOfWeek: 1, opensLocal: '08:00:00', closesLocal: '18:00:00' }],
};
const directory = {
  getDealership: async () => dealership,
  getServiceType: async () => ({
    id: 'fs',
    durationMinutes: 90,
    requiredSkillCode: 'full_service',
  }),
  getTechnician: async (id: string) => ({ id, dealershipId: 'd1', active: true }),
};
const now = new Date('2030-01-01T00:00:00Z');
const q = {
  dealershipId: 'd1',
  serviceTypeId: 'fs',
  startAt: new Date('2030-01-07T09:00:00Z'),
  preferredTechnicianId: null as string | null,
};

function make(bays: string[], techs: string[]) {
  const repo = { findFreeBays: async () => bays, findFreeTechnicians: async () => techs };
  const finder = new CandidateFinder(
    directory as never,
    new BookingPolicy(),
    new CandidateSelector(),
    repo as never,
  );
  return new AvailabilityService(finder);
}

describe('AvailabilityService', () => {
  it('returns the window and ranked pairs (same order as booking)', async () => {
    const a = await make(['b2', 'b1'], ['t1']).findFreeSlots(q, now);
    expect(a.available).toBe(true);
    expect(a.preferenceHonored).toBeNull();
    expect(a.window.endAt.toISOString()).toBe('2030-01-07T10:30:00.000Z');
    expect(a.window.blockedUntil.toISOString()).toBe('2030-01-07T10:45:00.000Z');
    expect(a.candidates.map((c) => c.bayId)).toEqual(['b1', 'b2']);
  });

  it('preferenceHonored: true when the named technician is free, false otherwise', async () => {
    const svc = make(['b1'], ['t1', 't2']);
    expect(
      (await svc.findFreeSlots({ ...q, preferredTechnicianId: 't2' }, now)).preferenceHonored,
    ).toBe(true);
    expect(
      (await svc.findFreeSlots({ ...q, preferredTechnicianId: 't9' }, now)).preferenceHonored,
    ).toBe(false);
  });

  it('nobody free: available false, and preferenceHonored false when a name was sent', async () => {
    const a = await make(['b1'], []).findFreeSlots({ ...q, preferredTechnicianId: 't1' }, now);
    expect(a).toMatchObject({ available: false, preferenceHonored: false, candidates: [] });
  });

  it(`caps the candidate list at ${AVAILABILITY_CANDIDATE_CAP}`, async () => {
    const bays = Array.from({ length: 6 }, (_, i) => `b${i}`);
    const techs = Array.from({ length: 6 }, (_, i) => `t${i}`);
    expect((await make(bays, techs).findFreeSlots(q, now)).candidates).toHaveLength(
      AVAILABILITY_CANDIDATE_CAP,
    );
  });

  it('applies the same opening-hours rule as booking (17:00 + 90 min is 422)', async () => {
    await expect(
      make(['b1'], ['t1']).findFreeSlots({ ...q, startAt: new Date('2030-01-07T17:00:00Z') }, now),
    ).rejects.toBeInstanceOf(BookingRuleError);
  });
});
