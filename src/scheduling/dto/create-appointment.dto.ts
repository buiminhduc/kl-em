import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsOptional, IsUUID, Matches } from 'class-validator';

/** ISO-8601 instant must end in Z or ±HH:MM; a naive local time is rejected with 400 (design: "What 9am means"). */
export const OFFSET_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/;

export class CreateAppointmentDto {
  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000001' })
  @IsUUID()
  dealershipId!: string;

  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000401' })
  @IsUUID()
  customerId!: string;

  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000501' })
  @IsUUID()
  vehicleId!: string;

  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000301' })
  @IsUUID()
  serviceTypeId!: string;

  @ApiProperty({
    format: 'date-time',
    example: '2026-11-02T09:00:00Z',
    description:
      'ISO-8601 instant with an offset (Z or ±HH:MM). Not more than one minute in the past.',
  })
  @IsISO8601({ strict: true })
  @Matches(OFFSET_SUFFIX, { message: 'startAt must include a timezone offset (Z or ±HH:MM)' })
  startAt!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    example: '00000000-0000-4000-8000-000000000201',
    description:
      'Soft preference: assigned when free and qualified, otherwise another qualified technician is used.',
  })
  @IsOptional()
  @IsUUID()
  preferredTechnicianId?: string;
}
