import { Injectable } from '@nestjs/common';
import type { OverlapResource } from './errors';
import type { Candidate } from './scheduling.types';

/**
 * Orders the (bay, technician) pairs a booking will try, as the design specifies:
 * the preferred technician first when they are in the free qualified set, then lowest bay id,
 * then lowest technician id. A stable order keeps retries predictable and tests deterministic.
 */
@Injectable()
export class CandidateSelector {
  rank(
    bayIds: string[],
    technicianIds: string[],
    preferredTechnicianId: string | null,
  ): Candidate[] {
    const bays = [...bayIds].sort();
    const techs = [...technicianIds].sort();
    const pairs = bays.flatMap((bayId) => techs.map((technicianId) => ({ bayId, technicianId })));
    if (!preferredTechnicianId || !techs.includes(preferredTechnicianId)) return pairs;
    const preferred = pairs.filter((p) => p.technicianId === preferredTechnicianId);
    const others = pairs.filter((p) => p.technicianId !== preferredTechnicianId);
    return [...preferred, ...others];
  }

  /**
   * After a 23P01 (exclusion_violation) the constraint name tells us which resource was taken:
   * drop every remaining pair that uses it. A vehicle conflict leaves no pair at all.
   */
  dropTaken(remaining: Candidate[], tried: Candidate, resource: OverlapResource): Candidate[] {
    switch (resource) {
      case 'bay':
        return remaining.filter((c) => c.bayId !== tried.bayId);
      case 'technician':
        return remaining.filter((c) => c.technicianId !== tried.technicianId);
      case 'vehicle':
        return [];
    }
  }
}
