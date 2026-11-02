import { Injectable } from '@nestjs/common';
import { CandidateFinder, CandidateQuery } from './candidate-finder';
import type { BookingWindow, Candidate } from './scheduling.types';

/** Design: the candidate list is capped at 20; it is a hint for a UI, not a reservation. */
export const AVAILABILITY_CANDIDATE_CAP = 20;

export interface Availability {
  available: boolean;
  preferenceHonored: boolean | null;
  window: BookingWindow;
  candidates: Candidate[];
}

/**
 * GET /availability: read-only. Uses exactly the same CandidateFinder as booking, so a "yes" here
 * means a booking sent now would try these pairs in this order. Nothing is held: two callers can both
 * be told a slot is free, and the INSERT decides the winner (the loser gets 409).
 */
@Injectable()
export class AvailabilityService {
  constructor(private readonly finder: CandidateFinder) {}

  async findFreeSlots(q: CandidateQuery, now: Date = new Date()): Promise<Availability> {
    const { window, candidates } = await this.finder.find(q, now);
    return {
      available: candidates.length > 0,
      // true: named technician is in the free qualified set; false: named but not (even if nobody is
      // free); null: no name sent.
      preferenceHonored: q.preferredTechnicianId
        ? candidates.some((c) => c.technicianId === q.preferredTechnicianId)
        : null,
      window,
      candidates: candidates.slice(0, AVAILABILITY_CANDIDATE_CAP),
    };
  }
}
