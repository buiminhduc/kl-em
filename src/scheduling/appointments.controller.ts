import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiHeader,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { ErrorResponseDto } from '../platform/error-response.dto';
import { errorExamples, EXAMPLE_IDS } from '../platform/swagger-examples';
import { AvailabilityService } from './availability.service';
import { BookingService } from './booking.service';
import { AvailabilityQueryDto, AvailabilityResponseDto } from './dto/availability.dto';
import { AppointmentResponseDto } from './dto/appointment-response.dto';
import { CreateAppointmentDto } from './dto/create-appointment.dto';

const IDEMPOTENCY_KEY_MAX_LENGTH = 255;

/** HTTP adapter for the Scheduling module (Level 4: AppointmentsController). No booking rules here. */
@ApiTags('appointments')
@Controller()
export class AppointmentsController {
  constructor(
    private readonly booking: BookingService,
    private readonly availability: AvailabilityService,
  ) {}

  @Get('availability')
  @ApiTags('availability')
  @ApiOperation({
    summary: 'Can this service start at this time? Read-only, nothing is held',
    description:
      'Same rules and ordering as POST /appointments. A legal window with nobody free is 200 with available=false.',
  })
  @ApiOkResponse({ type: AvailabilityResponseDto })
  @ApiBadRequestResponse({
    examples: errorExamples(400, {
      missingOffset: 'startAt must include a timezone offset (Z or ±HH:MM)',
    }),
    type: ErrorResponseDto,
    description: 'Invalid query, or startAt without an offset',
  })
  @ApiNotFoundResponse({
    examples: errorExamples(404, {
      unknownDealership: 'Dealership 00000000-0000-4000-8000-00000000dead was not found.',
      unknownTechnician: 'Technician 00000000-0000-4000-8000-00000000dead was not found.',
    }),
    type: ErrorResponseDto,
    description: 'Unknown dealership, service type or technician',
  })
  @ApiUnprocessableEntityResponse({
    examples: errorExamples(422, {
      outsideHours: 'The service must fit within opening hours (08:00-18:00 local time).',
      closedDay: 'The dealership is closed on that day.',
      inThePast: 'startAt is in the past.',
    }),
    type: ErrorResponseDto,
    description: 'Outside opening hours, or start in the past',
  })
  async getAvailability(@Query() q: AvailabilityQueryDto): Promise<AvailabilityResponseDto> {
    const result = await this.availability.findFreeSlots({
      dealershipId: q.dealershipId,
      serviceTypeId: q.serviceTypeId,
      startAt: new Date(q.startAt),
      preferredTechnicianId: q.preferredTechnicianId ?? null,
    });
    return AvailabilityResponseDto.from(result);
  }

  @Get('appointments/:id')
  @ApiOperation({
    summary: 'Fetch an appointment by id',
    description: 'Returns the same shape as POST /appointments, including cancelled appointments.',
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.appointment })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    examples: errorExamples(400, { notAUuid: 'Validation failed (uuid is expected)' }),
    description: 'id is not a UUID',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    examples: errorExamples(404, {
      unknownAppointment: 'Appointment 00000000-0000-4000-8000-00000000dead was not found.',
    }),
    description: 'Unknown appointment id',
  })
  async getById(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentResponseDto> {
    return AppointmentResponseDto.from(await this.booking.getById(id));
  }

  @Patch('appointments/:id/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Cancel an appointment; frees bay, technician and vehicle immediately (buffer included)',
    description:
      'No body. Repeating the cancel returns 200 with the same row; cancelledAt does not change.',
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.appointment })
  @ApiOkResponse({ type: AppointmentResponseDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    examples: errorExamples(400, { notAUuid: 'Validation failed (uuid is expected)' }),
    description: 'id is not a UUID',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    examples: errorExamples(404, {
      unknownAppointment: 'Appointment 00000000-0000-4000-8000-00000000dead was not found.',
    }),
    description: 'Unknown appointment id',
  })
  async cancel(@Param('id', ParseUUIDPipe) id: string): Promise<AppointmentResponseDto> {
    return AppointmentResponseDto.from(await this.booking.cancel(id));
  }

  @Post('appointments')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Book a service: the server assigns a free bay and a qualified technician',
    description:
      'Holds bay, technician and vehicle for the work plus the dealership turnaround buffer. ' +
      'The work must fit inside opening hours; the buffer may run past close.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-generated token. Same key + same body returns the original appointment (200); same key + different body is 409.',
  })
  @ApiCreatedResponse({ type: AppointmentResponseDto, description: 'Booked' })
  @ApiOkResponse({
    type: AppointmentResponseDto,
    description: 'Idempotent replay of a committed booking',
  })
  @ApiBadRequestResponse({
    examples: errorExamples(400, {
      missingOffset: 'startAt must include a timezone offset (Z or ±HH:MM)',
    }),
    type: ErrorResponseDto,
    description: 'Malformed body, or startAt without an offset',
  })
  @ApiNotFoundResponse({
    examples: errorExamples(404, {
      unknownTechnician: 'Technician 00000000-0000-4000-8000-00000000dead was not found.',
    }),
    type: ErrorResponseDto,
    description: 'Unknown dealership, service type, customer, vehicle or preferred technician',
  })
  @ApiConflictResponse({
    examples: errorExamples(409, {
      noFreePair:
        'No service bay and qualified technician are free for the full duration, including the turnaround buffer.',
      idempotencyKeyReused: 'This Idempotency-Key was already used with a different request body.',
    }),
    type: ErrorResponseDto,
    description:
      'No free bay + qualified technician pair (after up to 3 insert attempts), or Idempotency-Key reused with a different body',
  })
  @ApiUnprocessableEntityResponse({
    examples: errorExamples(422, {
      outsideHours: 'The service must fit within opening hours (08:00-18:00 local time).',
      inThePast: 'startAt is in the past.',
      vehicleNotOwned: 'The vehicle does not belong to this customer.',
    }),
    type: ErrorResponseDto,
    description: 'Outside opening hours, start in the past, or vehicle not owned by the customer',
  })
  async book(
    @Body() body: CreateAppointmentDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AppointmentResponseDto> {
    if (
      idempotencyKey !== undefined &&
      (idempotencyKey.length === 0 || idempotencyKey.length > IDEMPOTENCY_KEY_MAX_LENGTH)
    ) {
      throw new BadRequestException(
        `Idempotency-Key must be 1-${IDEMPOTENCY_KEY_MAX_LENGTH} characters`,
      );
    }
    const result = await this.booking.book({
      dealershipId: body.dealershipId,
      customerId: body.customerId,
      vehicleId: body.vehicleId,
      serviceTypeId: body.serviceTypeId,
      startAt: new Date(body.startAt),
      preferredTechnicianId: body.preferredTechnicianId ?? null,
      idempotencyKey: idempotencyKey ?? null,
    });
    if (result.replayed) res.status(200);
    return AppointmentResponseDto.from(result.appointment);
  }
}
