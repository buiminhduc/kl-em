import { ApiProperty } from '@nestjs/swagger';

/** Error body from the design's API contract; every error carries the request id. */
export class ErrorResponseDto {
  @ApiProperty({ example: 409 }) statusCode!: number;
  @ApiProperty({ example: 'Conflict' }) error!: string;
  @ApiProperty({
    example:
      'No service bay and qualified technician are free for the full duration, including the turnaround buffer.',
  })
  message!: string;
  @ApiProperty({ example: '8f0c2d1a-7b34-4e0a-9c11-6a5d0e8b12f4' }) requestId!: string;
}
