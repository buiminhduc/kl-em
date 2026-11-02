import { DynamicModule, Module } from '@nestjs/common';
import { DirectoryModule } from './directory/directory.module';
import { AppConfig } from './platform/config';
import { PlatformModule } from './platform/platform.module';
import { SchedulingModule } from './scheduling/scheduling.module';

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [PlatformModule.forRoot(config), DirectoryModule, SchedulingModule],
    };
  }
}
