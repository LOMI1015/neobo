import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../src/application.js';
import { parseConfig } from '../src/config.js';
import { createRuntimeLogging } from '../src/logging.js';
import type { RuntimeLogging } from '../src/logging.js';

const config = parseConfig({
  DATABASE_URL: 'postgresql://neobo:test-only-secret@127.0.0.1:15432/neobo',
  REDIS_URL: 'redis://:test-only-secret@127.0.0.1:16379',
});

describe('NestJS + Fastify request lifecycle', () => {
  let app: NestFastifyApplication | undefined;
  let logging: RuntimeLogging;
  let logLines: string[];

  beforeEach(() => {
    logLines = [];
    logging = createRuntimeLogging({
      environment: 'test',
      destination: { write: (line: string) => logLines.push(line) },
    });
  });

  afterEach(async () => {
    try {
      await app?.close();
    } finally {
      app = undefined;
      await logging.close();
    }
  });

  it('keeps liveness independent of unavailable databases', async () => {
    const postgres = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    const redis = vi.fn<() => Promise<boolean>>().mockResolvedValue(false);
    app = await createApplication(config, { postgres, redis }, { logging });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({ method: 'GET', url: '/api/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    expect(postgres).not.toHaveBeenCalled();
    expect(redis).not.toHaveBeenCalled();

    const missing = await app.inject({ method: 'GET', url: '/health' });
    expect(missing.statusCode).toBe(404);
  });

  it('returns ready only when both dependencies answer', async () => {
    app = await createApplication(
      config,
      {
        postgres: () => Promise.resolve(true),
        redis: () => Promise.resolve(true),
      },
      { logging },
    );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const response = await app.inject({ method: 'GET', url: '/api/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ready',
      checks: { postgres: 'up', redis: 'up' },
    });
  });

  it('returns 503 with sanitized dependency status and deduplicates concurrent probes', async () => {
    const postgres = vi
      .fn<() => Promise<boolean>>()
      .mockRejectedValue(new Error(config.databaseUrl));
    const redis = vi.fn<() => Promise<boolean>>().mockResolvedValue(true);
    app = await createApplication(config, { postgres, redis }, { logging });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    const responses = await Promise.all([
      app.inject({ method: 'GET', url: '/api/ready' }),
      app.inject({ method: 'GET', url: '/api/ready' }),
    ]);
    for (const response of responses) {
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        status: 'not_ready',
        checks: { postgres: 'down', redis: 'up' },
      });
      expect(response.body).not.toContain('test-only-secret');
      expect(response.body).not.toContain('postgresql://');
    }
    expect(postgres).toHaveBeenCalledTimes(1);
    expect(redis).toHaveBeenCalledTimes(1);
    const records: unknown[] = logLines.map((line) => {
      const record: unknown = JSON.parse(line);
      return record;
    });
    const completed = records.filter(
      (record) =>
        typeof record === 'object' &&
        record !== null &&
        'event' in record &&
        record.event === 'http.completed',
    );
    expect(completed).toHaveLength(2);
    for (const response of responses) {
      expect(completed).toContainEqual(
        expect.objectContaining({
          requestId: response.headers['x-request-id'],
          route: '/api/ready',
          statusCode: 503,
          outcome: 'failure',
          errorCode: 'HTTP_SERVICE_UNAVAILABLE',
        }),
      );
    }
    expect(logLines.join('')).not.toContain('http.error');
    expect(logLines.join('')).not.toContain('test-only-secret');
  });
});
