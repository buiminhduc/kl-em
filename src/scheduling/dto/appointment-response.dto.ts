import { ApiProperty } from '@nestjs/swagger';
import { AppointmentRow, preferenceHonored } from '../scheduling.types';

export class AppointmentResponseDto {
  @ApiProperty({ format: 'uuid', example: '3b9d6c1e-2f4a-4c8e-9a71-5d0b2e6f8c13' }) id!: string;
  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000001' })
  dealershipId!: string;
  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000401' })
  customerId!: string;
  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000501' })
  vehicleId!: string;
  @ApiProperty({ format: 'uuid', example: '00000000-0000-4000-8000-000000000301' })
  serviceTypeId!: string;
  @ApiProperty({
    format: 'uuid',
    description: 'Assigned by the server',
    example: '00000000-0000-4000-8000-000000000201',
  })
  technicianId!: string;
  @ApiProperty({
    format: 'uuid',
    description: 'Assigned by the server',
    example: '00000000-0000-4000-8000-000000000101',
  })
  bayId!: string;
  @ApiProperty({
    format: 'uuid',
    nullable: true,
    type: String,
    example: '00000000-0000-4000-8000-000000000201',
  })
  preferredTechnicianId!: string | null;
  @ApiProperty({
    nullable: true,
    type: Boolean,
    description:
      'true: preferred technician assigned; false: someone else was; null: no preference sent',
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
    description: 'When bay, technician and vehicle come free (endAt + bufferMinutes)',
    example: '2026-11-02T10:45:00.000Z',
  })
  blockedUntil!: string;
  @ApiProperty({ example: 15 }) bufferMinutes!: number;
  @ApiProperty({ enum: ['confirmed', 'cancelled'], example: 'confirmed' }) status!: string;
  @ApiProperty({ format: 'date-time', example: '2026-10-28T12:00:00.000Z' }) createdAt!: string;
  @ApiProperty({ format: 'date-time', nullable: true, type: String, example: null }) cancelledAt!:
    string | null;

  static from(row: AppointmentRow): AppointmentResponseDto {
    const iso = (d: Date | string) => new Date(d).toISOString();
    return {
      id: row.id,
      dealershipId: row.dealership_id,
      customerId: row.customer_id,
      vehicleId: row.vehicle_id,
      serviceTypeId: row.service_type_id,
      technicianId: row.technician_id,
      bayId: row.bay_id,
      preferredTechnicianId: row.preferred_technician_id,
      preferenceHonored: preferenceHonored(row),
      startAt: iso(row.start_at),
      endAt: iso(row.end_at),
      blockedUntil: iso(row.blocked_until),
      bufferMinutes: row.buffer_minutes,
      status: row.status,
      createdAt: iso(row.created_at),
      cancelledAt: row.cancelled_at ? iso(row.cancelled_at) : null,
    };
  }
}
