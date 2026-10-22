import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import type { ApiConfig } from './config.js';
import type { DependencyProbes } from './health/dependency-probes.js';
import { HttpExceptionFilter } from './http-exception.filter.js';

export async function createApplication(
  config: ApiConfig,
  probes?: DependencyProbes,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule.register(config, probes),
    new FastifyAdapter({ logger: false, bodyLimit: 1_048_576 }),
    { logger: ['log', 'warn'], abortOnError: false },
  );
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new HttpExceptionFilter());
  return app;
}
