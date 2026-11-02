import { ApiProperty } from '@nestjs/swagger';
import { EXAMPLE_IDS } from '../../platform/swagger-examples';
import type { DealershipDetail, DealershipSummary } from '../directory.types';

/** Examples come from the Northbridge seed (src/db/seed-data.ts), so "Try it out" matches a seeded DB. */
export class DealershipSummaryDto implements DealershipSummary {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.dealership }) id!: string;
  @ApiProperty({ example: 'Northbridge' }) name!: string;
  @ApiProperty({ description: 'IANA time zone of the dealership', example: 'Europe/London' })
  timezone!: string;
}

export class OpeningHoursDto {
  @ApiProperty({
    description: 'ISO weekday: Monday = 1 … Sunday = 7. A missing day is closed.',
    example: 1,
  })
  dayOfWeek!: number;
  @ApiProperty({ description: 'Local wall-clock time (HH:MM)', example: '08:00' })
  opensLocal!: string;
  @ApiProperty({ description: 'Local wall-clock time (HH:MM)', example: '18:00' })
  closesLocal!: string;
}

export class ServiceBayDto {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.bay1 }) id!: string;
  @ApiProperty({ example: 'Bay 1' }) name!: string;
  @ApiProperty({ description: 'Inactive bays are never assigned', example: true }) active!: boolean;
}

export class SkillDto {
  @ApiProperty({ example: 'full_service' }) code!: string;
  @ApiProperty({ example: 'Full service' }) name!: string;
}

export class TechnicianDto {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.sam }) id!: string;
  @ApiProperty({ example: 'Sam' }) name!: string;
  @ApiProperty({ description: 'Inactive technicians are never assigned', example: true })
  active!: boolean;
  @ApiProperty({
    type: [SkillDto],
    example: [
      { code: 'full_service', name: 'Full service' },
      { code: 'mot', name: 'MOT' },
    ],
  })
  skills!: SkillDto[];
}

export class ServiceTypeDto {
  @ApiProperty({ format: 'uuid', example: EXAMPLE_IDS.fullService }) id!: string;
  @ApiProperty({ example: 'full_service' }) code!: string;
  @ApiProperty({ example: 'Full service' }) name!: string;
  @ApiProperty({ description: 'Length of the work, without the turnaround buffer', example: 90 })
  durationMinutes!: number;
  @ApiProperty({ description: 'Skill the assigned technician must hold', example: 'full_service' })
  requiredSkillCode!: string;
}

export class DealershipDetailDto extends DealershipSummaryDto implements DealershipDetail {
  @ApiProperty({
    description: 'Turnaround buffer held after every job (bay, technician and vehicle)',
    example: 15,
  })
  bufferMinutes!: number;
  @ApiProperty({ type: [OpeningHoursDto] }) openingHours!: OpeningHoursDto[];
  @ApiProperty({ type: [ServiceBayDto] }) serviceBays!: ServiceBayDto[];
  @ApiProperty({ type: [TechnicianDto] }) technicians!: TechnicianDto[];
  @ApiProperty({
    type: [ServiceTypeDto],
    description:
      'Service types are a global catalogue, so every type is listed for every dealership',
  })
  serviceTypes!: ServiceTypeDto[];
}
