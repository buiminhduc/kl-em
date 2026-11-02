import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';
import type { Availability } from '../availability.service';
import { OFFSET_SUFFIX } from './create-appointment.dto';

export class AvailabilityQueryDto {
  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000001' })
  @IsUUID()
  dealershipId!: string;

  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000301' })
  @IsUUID()
  serviceTypeId!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-11-02T09:00:00Z',
    description: 'Proposed start: ISO-8601 instant with an offset (Z or ±HH:MM)',
  })
  @IsISO8601({ strict: true })
  @Matches(OFFSET_SUFFIX, { message: 'startAt must include a timezone offset (Z or ±HH:MM)' })
  startAt!: string;

  @ApiPropertyOptional({ format: 'uuid', example: '00000000-0000-4000-8000-000000000201' })
  @IsOptional()
  @IsUUID()
  preferredTechnicianId?: string;
}

export class CandidatePairDto {
  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000101' }) bayId!: string;
  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000201' })
  technicianId!: string;
}

export class AvailabilityResponseDto {
  @ApiProperty({ description: 'candidates.length > 0', example: true }) available!: boolean;
  @ApiProperty({
    nullable: true,
    type: Boolean,
    example: true,
    description:
      'true: named technician is free and qualified; false: named but not; null: no technician named',
  })
  preferenceHonored!: boolean | null;
  @ApiProperty({ format: 'date-time', example: '2026-11-02T09:00:00.000Z' }) startAt!: string;
  @ApiProperty({
    format: 'date-time',
    description: 'End of the work',
    example: '2026-11-02T10:30:00.000Z',
  })
  endAt!: string;
  @ApiProperty({
    format: 'date-time',
    description: 'endAt + bufferMinutes',
    example: '2026-11-02T10:45:00.000Z',
  })
  blockedUntil!: string;
  @ApiProperty({ example: 15 }) bufferMinutes!: number;
  @ApiProperty({ example: 90 }) durationMinutes!: number;
  @ApiProperty({
    type: [CandidatePairDto],
    description: 'Free pairs in the order a booking would try them (max 20). A hint, not a hold.',
  })
  candidates!: CandidatePairDto[];

  static from(a: Availability): AvailabilityResponseDto {
    return {
      available: a.available,
      preferenceHonored: a.preferenceHonored,
      startAt: a.window.startAt.toISOString(),
      endAt: a.window.endAt.toISOString(),
      blockedUntil: a.window.blockedUntil.toISOString(),
      bufferMinutes: a.window.bufferMinutes,
      durationMinutes: a.window.durationMinutes,
      candidates: a.candidates.map((c) => ({ bayId: c.bayId, technicianId: c.technicianId })),
    };
  }
}
