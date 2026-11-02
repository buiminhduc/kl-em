import { Controller, Get, NotFoundException, Param, ParseUUIDPipe } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from '../platform/error-response.dto';
import { errorExamples, EXAMPLE_IDS } from '../platform/swagger-examples';
import { DirectoryReader } from './directory-reader';
import { DealershipDetailDto, DealershipSummaryDto } from './dto/dealership.dto';

/**
 * Read-only Directory API: lets a client discover the ids it needs for /availability and
 * POST /appointments. Master data has no write API (see README "Out of scope").
 */
@ApiTags('directory')
@Controller('dealerships')
export class DealershipsController {
  constructor(private readonly directory: DirectoryReader) {}

  @Get()
  @ApiOperation({
    summary: 'List dealerships',
    description: 'Ordered by name. Not paginated (a known limitation; see README).',
  })
  @ApiOkResponse({ type: [DealershipSummaryDto] })
  list(): Promise<DealershipSummaryDto[]> {
    return this.directory.listDealerships();
  }

  @Get(':id')
  @ApiOperation({
    summary: 'A dealership with opening hours, bays, technicians (with skills) and service types',
    description: 'Everything needed to build a GET /availability or POST /appointments request.',
  })
  @ApiParam({ name: 'id', format: 'uuid', example: EXAMPLE_IDS.dealership })
  @ApiOkResponse({ type: DealershipDetailDto })
  @ApiBadRequestResponse({
    type: ErrorResponseDto,
    examples: errorExamples(400, { notAUuid: 'Validation failed (uuid is expected)' }),
    description: 'id is not a UUID',
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDto,
    examples: errorExamples(404, {
      unknownDealership: 'Dealership 00000000-0000-4000-8000-00000000dead was not found.',
    }),
    description: 'Unknown dealership id',
  })
  async get(@Param('id', ParseUUIDPipe) id: string): Promise<DealershipDetailDto> {
    const dealership = await this.directory.getDealershipDetail(id);
    if (!dealership) throw new NotFoundException(`Dealership ${id} was not found.`);
    return dealership;
  }
}
