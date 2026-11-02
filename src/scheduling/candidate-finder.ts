import { Injectable } from '@nestjs/common';
import { DirectoryReader } from '../directory/directory-reader';
import type { Dealership, ServiceType } from '../directory/directory.types';
import { AppointmentRepository } from './appointment-repository';
import { BookingPolicy } from './booking-policy';
import { CandidateSelector } from './candidate-selector';
import { NotFoundError } from './errors';
import type { BookingWindow, Candidate } from './scheduling.types';

export interface CandidateQuery {
  dealershipId: string;
  serviceTypeId: string;
  startAt: Date;
  preferredTechnicianId: string | null;
}

export interface CandidateSet {
  dealership: Dealership;
  serviceType: ServiceType;
  window: BookingWindow;
  /** Ranked free (bay, qualified technician) pairs, in the order a booking would try them. */
  candidates: Candidate[];
}

/**
 * The one place that turns "dealership + service type + start (+ preferred technician)" into a window
 * and ranked free pairs. Both GET /availability and POST /appointments call it, so availability can
 * never disagree with booking about hours, buffer, skills or ordering.
 */
@Injectable()
export class CandidateFinder {
  constructor(
    private readonly directory: DirectoryReader,
    private readonly policy: BookingPolicy,
    private readonly selector: CandidateSelector,
    private readonly repository: AppointmentRepository,
  ) {}

  async find(q: CandidateQuery, now: Date): Promise<CandidateSet> {
    const dealership = await this.directory.getDealership(q.dealershipId);
    if (!dealership) throw new NotFoundError('Dealership', q.dealershipId);
    const serviceType = await this.directory.getServiceType(q.serviceTypeId);
    if (!serviceType) throw new NotFoundError('Service type', q.serviceTypeId);
    // Unknown preferred technician is 404. One who exists but is busy, inactive, unqualified or at
    // another dealership simply drops out of the candidate set (soft preference).
    if (q.preferredTechnicianId && !(await this.directory.getTechnician(q.preferredTechnicianId))) {
      throw new NotFoundError('Technician', q.preferredTechnicianId);
    }

    this.policy.assertNotInPast(q.startAt, now);
    const window = this.policy.window(serviceType, q.startAt, dealership);
    this.policy.assertWithinOpeningHours(window, dealership);

    const range = { startAt: window.startAt, blockedUntil: window.blockedUntil };
    const [bays, technicians] = await Promise.all([
      this.repository.findFreeBays(dealership.id, range),
      this.repository.findFreeTechnicians(dealership.id, serviceType.requiredSkillCode, range),
    ]);
    const candidates = this.selector.rank(bays, technicians, q.preferredTechnicianId);
    return { dealership, serviceType, window, candidates };
  }
}
