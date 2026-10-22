import { Module } from '@nestjs/common';
import type { DynamicModule } from '@nestjs/common';
import type { ApiConfig } from './config.js';
import { createDependencyProbes } from './health/dependency-probes.js';
import type { DependencyProbes } from './health/dependency-probes.js';
import { HealthController } from './health/health.controller.js';
import { ReadinessService } from './health/readiness.service.js';

@Module({})
export class AppModule {
  static register(config: ApiConfig, probes?: DependencyProbes): DynamicModule {
    return {
      module: AppModule,
      controllers: [HealthController],
      providers: [
        {
          provide: ReadinessService,
          useFactory: () => new ReadinessService(probes ?? createDependencyProbes(config)),
        },
      ],
    };
  }
}
