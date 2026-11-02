import { Module } from '@nestjs/common';
import { DirectoryModule } from '../directory/directory.module';
import { AppointmentRepository } from './appointment-repository';
import { AppointmentsController } from './appointments.controller';
import { AvailabilityService } from './availability.service';
import { BookingHooks } from './booking-hooks';
import { BookingPolicy } from './booking-policy';
import { BookingService } from './booking.service';
import { CandidateFinder } from './candidate-finder';
import { CandidateSelector } from './candidate-selector';

/** Scheduling: the only writer of appointments. Owns the booking policy and the retry loop. */
@Module({
  imports: [DirectoryModule],
  controllers: [AppointmentsController],
  providers: [
    BookingService,
    AvailabilityService,
    CandidateFinder,
    BookingPolicy,
    CandidateSelector,
    AppointmentRepository,
    BookingHooks,
  ],
})
export class SchedulingModule {}
