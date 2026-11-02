import { Module } from '@nestjs/common';
import { DealershipsController } from './dealerships.controller';
import { DirectoryReader } from './directory-reader';

/**
 * Directory: read models for reference data (dealerships, hours, bays, technicians, skills,
 * customers, vehicles, service types). It knows what exists, not what is free.
 * Its only HTTP surface is the read-only GET /dealerships and GET /dealerships/:id.
 */
@Module({
  controllers: [DealershipsController],
  providers: [DirectoryReader],
  exports: [DirectoryReader],
})
export class DirectoryModule {}
