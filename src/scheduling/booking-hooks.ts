import { Injectable } from '@nestjs/common';
import type { BookingWindow, Candidate } from './scheduling.types';

/**
 * Single test seam from the design ("afterCandidatesSelected"). A no-op in production. Integration tests
 * override this provider to commit a conflicting appointment between "read free pairs" and "insert",
 * so the app receives a genuine 23P01 deterministically. It does not stub the constraint.
 */
@Injectable()
export class BookingHooks {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async afterCandidatesSelected(_candidates: Candidate[], _window: BookingWindow): Promise<void> {}
}
