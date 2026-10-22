import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import type { DynamicModule, Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { AppModule } from './app.module.js';
import type { ApiConfig } from './config.js';
import type { DependencyProbes } from './health/dependency-probes.js';
import { HttpExceptionFilter } from './http-exception.filter.js';
import { handleFrameworkError, registerHttpLogging } from './http-logging.js';
import { createRuntimeLogging } from './logging.js';
import type { RuntimeLogging } from './logging.js';

export async function createApplication(
  config: ApiConfig,
  probes?: DependencyProbes,
  options: {
    readonly logging?: RuntimeLogging;
    readonly rootModule?: Type<unknown> | DynamicModule;
  } = {},
): Promise<NestFastifyApplication> {
  const logging = options.logging ?? createRuntimeLogging();
  let adapter: FastifyAdapter | undefined;
  try {
    adapter = new FastifyAdapter({
      loggerInstance: logging.pino,
      logController: new LogController({
        disableRequestLogging: true,
        requestIdLogLabel: 'requestId',
      }),
      requestIdHeader: false,
      genReqId: () => randomUUID(),
      bodyLimit: 1_048_576,
      frameworkErrors: (error: FastifyError, request: FastifyRequest, reply: FastifyReply) =>
        handleFrameworkError(error, request, reply, logging),
    });
    const fastify = adapter.getInstance();
    registerHttpLogging(fastify, logging);
    const app = await NestFactory.create<NestFastifyApplication>(
      options.rootModule ?? AppModule.register(config, probes),
      adapter,
      { logger: logging.nest, abortOnError: false },
    );
    app.setGlobalPrefix('api');
    app.useGlobalFilters(new HttpExceptionFilter(logging));
    if (!options.logging) {
      fastify.addHook('onClose', () => logging.close());
    }
    return app;
  } catch (error) {
    try {
      await adapter?.close();
    } finally {
      if (!options.logging) await logging.close();
    }
    throw error;
  }
}
