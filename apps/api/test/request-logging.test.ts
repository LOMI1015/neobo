import { request as httpRequest } from 'node:http';
import type { ClientRequest } from 'node:http';
import type { Socket } from 'node:net';
import { Writable } from 'node:stream';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyInstance, InjectOptions, LightMyRequestResponse } from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../src/application.js';
import { parseConfig } from '../src/config.js';
import { createRuntimeLogging } from '../src/logging.js';
import type { RuntimeLogging } from '../src/logging.js';

const config = parseConfig({
  DATABASE_URL: 'postgresql://neobo:database-secret@127.0.0.1:15432/neobo',
  REDIS_URL: 'redis://:redis-secret@127.0.0.1:16379',
});
const secrets = {
  path: 'synthetic-path-secret',
  query: 'synthetic-query-secret',
  header: 'synthetic-header-secret',
  cookie: 'synthetic-cookie-secret',
  body: 'synthetic-body-secret',
  error: 'synthetic-error-secret',
  cause: 'synthetic-cause-secret',
  clientId: 'synthetic-client-id-secret',
  message: 'synthetic-message-secret',
};
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function captureOutput() {
  let output = '';
  const destination = new Writable({
    write(chunk: unknown, _encoding, callback) {
      if (Buffer.isBuffer(chunk)) output += chunk.toString('utf8');
      else if (typeof chunk === 'string') output += chunk;
      else {
        callback(new Error('日志输出必须是文本。'));
        return;
      }
      callback();
    },
  });
  return {
    destination,
    text: () => output,
    records: () =>
      output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const record: unknown = JSON.parse(line);
          if (!isRecord(record)) throw new Error('日志必须是 JSON 对象。');
          return record;
        }),
  };
}

function responseRequestId(response: LightMyRequestResponse): string {
  const value = response.headers['x-request-id'];
  expect(value).toEqual(expect.stringMatching(uuidPattern));
  if (typeof value !== 'string') throw new Error('响应缺少服务端请求标识。');
  return value;
}

function expectSecretsAbsent(output: string): void {
  for (const secret of Object.values(secrets)) expect(output).not.toContain(secret);
  expect(output).not.toContain(config.databaseUrl);
  expect(output).not.toContain(config.redisUrl);
}

const requestCases: {
  readonly name: string;
  readonly request: InjectOptions;
  readonly statusCode: number;
  readonly route: string;
  readonly code?: string;
}[] = [
  {
    name: 'Nest 健康检查成功',
    request: { method: 'GET', url: `/api/health?token=${secrets.query}` },
    statusCode: 200,
    route: '/api/health',
  },
  {
    name: '动态路由和请求体',
    request: {
      method: 'POST',
      url: `/test/items/${secrets.path}?token=${secrets.query}`,
      payload: { password: secrets.body },
    },
    statusCode: 200,
    route: '/test/items/:id',
  },
  {
    name: '带嵌套原因的内部错误',
    request: { method: 'GET', url: `/test/fail/${secrets.path}?token=${secrets.query}` },
    statusCode: 500,
    route: '/test/fail/:id',
    code: 'HTTP_INTERNAL_ERROR',
  },
  {
    name: '未匹配路由',
    request: { method: 'GET', url: `/missing/${secrets.path}?token=${secrets.query}` },
    statusCode: 404,
    route: '[unmatched]',
    code: 'HTTP_NOT_FOUND',
  },
  {
    name: '无效 JSON',
    request: {
      method: 'POST',
      url: `/test/items/${secrets.path}?token=${secrets.query}`,
      headers: { 'content-type': 'application/json' },
      payload: `{"password":"${secrets.body}",`,
    },
    statusCode: 400,
    route: '/test/items/:id',
    code: 'HTTP_BAD_REQUEST',
  },
  {
    name: '超过请求体上限',
    request: {
      method: 'POST',
      url: `/test/items/${secrets.path}?token=${secrets.query}`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ password: secrets.body, value: 'x'.repeat(1_048_576) }),
    },
    statusCode: 413,
    route: '/test/items/:id',
    code: 'HTTP_PAYLOAD_TOO_LARGE',
  },
  {
    name: '不支持的请求媒体类型',
    request: {
      method: 'POST',
      url: `/test/items/${secrets.path}?token=${secrets.query}`,
      headers: { 'content-type': `application/${secrets.header}` },
      payload: secrets.body,
    },
    statusCode: 415,
    route: '/test/items/:id',
    code: 'HTTP_UNSUPPORTED_MEDIA_TYPE',
  },
  {
    name: '进入请求钩子前的畸形 URL',
    request: { method: 'GET', url: `/${secrets.path}/%ZZ?token=${secrets.query}` },
    statusCode: 400,
    route: '[unmatched]',
    code: 'HTTP_BAD_REQUEST',
  },
  {
    name: '进入请求钩子前的过长路由参数',
    request: { method: 'POST', url: `/test/items/${secrets.path.repeat(6)}` },
    statusCode: 414,
    route: '[unmatched]',
    code: 'HTTP_REQUEST_FAILED',
  },
];

describe('请求日志真实链路验收', () => {
  let app: NestFastifyApplication | undefined;
  let logging: RuntimeLogging | undefined;
  let output: ReturnType<typeof captureOutput> | undefined;

  afterEach(async () => {
    try {
      await app?.close();
    } finally {
      try {
        await logging?.close();
      } finally {
        output?.destination.destroy();
        app = undefined;
        logging = undefined;
        output = undefined;
      }
    }
  });

  async function start(register?: (server: FastifyInstance, runtime: RuntimeLogging) => void) {
    const captured = captureOutput();
    output = captured;
    const runtime = createRuntimeLogging({
      environment: 'test',
      destination: captured.destination,
    });
    logging = runtime;
    const application = await createApplication(config, undefined, { logging: runtime });
    app = application;
    const server: FastifyInstance = application.getHttpAdapter().getInstance();
    register?.(server, runtime);
    await application.init();
    await server.ready();
    return { app: application, server, logging: runtime, output: captured };
  }

  it.each(requestCases)('$name：只记录一次受控完成摘要', async (testCase) => {
    const fixture = await start((server) => {
      server.post('/test/items/:id', () => ({ status: 'ok' }));
      server.get('/test/fail/:id', () => {
        throw new Error(secrets.error, {
          cause: new Error(`${secrets.cause}: ${config.databaseUrl}`),
        });
      });
    });
    const response = await fixture.app.inject({
      ...testCase.request,
      headers: {
        ...testCase.request.headers,
        authorization: `Bearer ${secrets.header}`,
        cookie: `session=${secrets.cookie}`,
        'x-request-id': secrets.clientId,
      },
    });
    expect(response.statusCode).toBe(testCase.statusCode);
    const requestId = responseRequestId(response);
    expect(requestId).not.toBe(secrets.clientId);
    if (testCase.code) {
      expect(response.json<unknown>()).toEqual({
        statusCode: testCase.statusCode,
        code: testCase.code,
        message: testCase.statusCode >= 500 ? 'Internal server error' : 'Request failed',
        requestId,
      });
    }

    const records = fixture.output.records();
    const completed = records.filter((record) => record.event === 'http.completed');
    expect(completed).toHaveLength(1);
    expect(completed[0]).toMatchObject({
      requestId,
      method: testCase.request.method,
      route: testCase.route,
      statusCode: testCase.statusCode,
      outcome: testCase.statusCode >= 400 ? 'failure' : 'success',
    });
    expect(completed[0]?.durationMs).toEqual(expect.any(Number));
    expect(completed[0]?.durationMs).toBeGreaterThanOrEqual(0);
    if (testCase.code) expect(completed[0]).toHaveProperty('errorCode', testCase.code);
    else expect(completed[0]).not.toHaveProperty('errorCode');

    const errors = records.filter((record) => record.event === 'http.error');
    expect(errors).toHaveLength(testCase.statusCode >= 500 ? 1 : 0);
    if (testCase.statusCode >= 500) {
      expect(errors[0]).toMatchObject({
        requestId,
        method: testCase.request.method,
        route: testCase.route,
        errorCode: testCase.code,
        statusCode: testCase.statusCode,
        outcome: 'failure',
      });
    }
    expect(records.filter((record) => record.requestId === requestId)).toHaveLength(
      testCase.statusCode >= 500 ? 2 : 1,
    );
    expectSecretsAbsent(fixture.output.text());
    expectSecretsAbsent(response.body);
    expect(fixture.logging.requestId()).toBeUndefined();
  });

  it('忽略外部有效 UUID 和重复请求标识头，每次重新生成标识', async () => {
    const fixture = await start();
    const clientId = '00000000-0000-4000-8000-000000000000';
    const responses = await Promise.all([
      fixture.app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { 'x-request-id': clientId },
      }),
      fixture.app.inject({
        method: 'GET',
        url: '/api/health',
        headers: { 'x-request-id': [clientId, secrets.clientId] },
      }),
    ]);
    const ids = responses.map(responseRequestId);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(id).not.toBe(clientId);
    const completed = fixture.output
      .records()
      .filter((record) => record.event === 'http.completed');
    expect(completed.map((record) => record.requestId).sort()).toEqual([...ids].sort());
    expect(fixture.output.text()).not.toContain(clientId);
    expectSecretsAbsent(fixture.output.text());
  });

  it('并发请求跨 Promise 和异步回调隔离上下文，Nest 与 Fastify 共用受控输出', async () => {
    let releaseRequests: (() => void) | undefined;
    const bothEntered = new Promise<void>((resolve) => {
      releaseRequests = resolve;
    });
    let entered = 0;
    const observed = new Map<
      string,
      {
        readonly before: string | undefined;
        readonly after: string | undefined;
        readonly id: string;
      }
    >();
    const fixture = await start((server, runtime) => {
      server.get<{ Params: { id: string } }>('/test/context/:id', async (request) => {
        const before = runtime.requestId();
        runtime.nest.warn(secrets.message, secrets.header);
        entered += 1;
        if (entered === 2) releaseRequests?.();
        await bothEntered;
        await new Promise<void>((resolve) => setImmediate(resolve));
        observed.set(request.params.id, { before, after: runtime.requestId(), id: request.id });
        request.log.warn(
          { req: request, body: secrets.body, err: new Error(secrets.error) },
          secrets.message,
        );
        return { status: 'ok' };
      });
    });
    const responses = await Promise.all(
      ['first', 'second'].map((id) =>
        fixture.app.inject({
          method: 'GET',
          url: `/test/context/${id}?token=${secrets.query}`,
          headers: { authorization: secrets.header },
        }),
      ),
    );
    for (const [index, key] of ['first', 'second'].entries()) {
      const response = responses[index];
      if (!response) throw new Error('并发请求未返回。');
      expect(response.statusCode).toBe(200);
      const requestId = responseRequestId(response);
      expect(observed.get(key)).toEqual({ before: requestId, after: requestId, id: requestId });
      const records = fixture.output.records().filter((record) => record.requestId === requestId);
      expect(records.filter((record) => record.event === 'framework.log')).toHaveLength(2);
      expect(records.filter((record) => record.event === 'http.completed')).toHaveLength(1);
    }
    expect(fixture.logging.requestId()).toBeUndefined();
    fixture.logging.nest.warn(secrets.message);
    const outside = fixture.output.records().at(-1);
    expect(outside).toMatchObject({ event: 'framework.log' });
    expect(outside).not.toHaveProperty('requestId');
    const instanceIds = fixture.output.records().map((record) => record.instanceId);
    expect(instanceIds[0]).toEqual(expect.stringMatching(uuidPattern));
    expect(new Set(instanceIds).size).toBe(1);
    expectSecretsAbsent(fixture.output.text());
  });

  it('框架错误、子日志配置和附加对象不能绕过允许字段', async () => {
    const fixture = await start((server, runtime) => {
      server.get('/test/framework', (request) => {
        runtime.nest.error(new Error(secrets.error), secrets.cause, secrets.message);
        server.log.warn({ headers: request.headers, body: secrets.body }, secrets.message);
        request.log
          .child(
            { authorization: secrets.header, url: secrets.query },
            {
              redact: [],
              msgPrefix: secrets.message,
              serializers: { req: () => ({ secret: secrets.body }) },
            },
          )
          .error({ req: request, err: new Error(secrets.error) }, secrets.message);
        return { status: 'ok' };
      });
    });
    const response = await fixture.app.inject({
      method: 'GET',
      url: '/test/framework',
      headers: { authorization: secrets.header },
    });
    expect(response.statusCode).toBe(200);
    const requestId = responseRequestId(response);
    const records = fixture.output.records().filter((record) => record.requestId === requestId);
    expect(records.filter((record) => record.event === 'framework.log')).toHaveLength(3);
    expect(records.filter((record) => record.event === 'http.completed')).toHaveLength(1);
    for (const record of records) {
      for (const field of [
        'req',
        'err',
        'headers',
        'body',
        'url',
        'authorization',
        'context',
        'stack',
      ]) {
        expect(record).not.toHaveProperty(field);
      }
    }
    expectSecretsAbsent(fixture.output.text());
  });

  it('客户端提前断开只记录一次取消摘要，释放处理器后不会伪造成功状态', async () => {
    let releaseHandler: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      releaseHandler = resolve;
    });
    let reportEntered: (() => void) | undefined;
    let reportFailed: ((error: Error) => void) | undefined;
    const entered = new Promise<void>((resolve, reject) => {
      reportEntered = resolve;
      reportFailed = reject;
    });
    let reportFinished: (() => void) | undefined;
    const finished = new Promise<void>((resolve) => {
      reportFinished = resolve;
    });
    let requestId: string | undefined;
    const fixture = await start((server) => {
      server.get('/test/cancel/:id', async (request) => {
        requestId = request.id;
        reportEntered?.();
        await released;
        reportFinished?.();
        return { status: 'ok' };
      });
    });
    const sockets = new Set<Socket>();
    let client: ClientRequest | undefined;
    let receivedResponse = false;
    try {
      await fixture.app.listen(0, '127.0.0.1');
      client = httpRequest(
        new URL(`/test/cancel/${secrets.path}?token=${secrets.query}`, await fixture.app.getUrl()),
        { agent: false, headers: { 'x-request-id': secrets.clientId } },
      );
      client.on('error', (error) => reportFailed?.(error));
      client.on('socket', (socket) => {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
      });
      client.on('response', (response) => {
        receivedResponse = true;
        response.resume();
      });
      client.end();
      await entered;
      client.destroy();
      await vi.waitFor(() => {
        expect(
          fixture.output.records().filter((record) => record.event === 'http.completed'),
        ).toHaveLength(1);
      });
      const completed = fixture.output
        .records()
        .filter((record) => record.event === 'http.completed');
      expect(completed[0]).toMatchObject({
        level: 40,
        requestId,
        method: 'GET',
        route: '/test/cancel/:id',
        outcome: 'cancelled',
        errorCode: 'HTTP_REQUEST_CANCELLED',
      });
      expect(requestId).toEqual(expect.stringMatching(uuidPattern));
      expect(completed[0]).not.toHaveProperty('statusCode');
      expect(receivedResponse).toBe(false);
      releaseHandler?.();
      await finished;
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(
        fixture.output.records().filter((record) => record.event === 'http.completed'),
      ).toHaveLength(1);
      expectSecretsAbsent(fixture.output.text());
    } finally {
      releaseHandler?.();
      client?.destroy();
      for (const socket of sockets) socket.destroy();
      await fixture.app.close();
      app = undefined;
    }
  });

  it('关闭应用时执行 Fastify 清理，并由调用者关闭注入的日志资源', async () => {
    const closed = vi.fn<() => void>();
    const fixture = await start((server) => {
      server.addHook('onClose', (_instance, done) => {
        closed();
        done();
      });
    });
    await fixture.app.inject({ method: 'GET', url: '/api/health' });
    await fixture.app.close();
    app = undefined;
    expect(closed).toHaveBeenCalledOnce();
    await expect(fixture.app.inject({ method: 'GET', url: '/api/health' })).rejects.toThrow();
    fixture.logging.nest.warn(secrets.message);
    await fixture.logging.close();
    logging = undefined;
    expect(fixture.output.records().at(-1)).toMatchObject({ event: 'framework.log' });
    expect(fixture.output.destination.destroyed).toBe(false);
    expect(fixture.output.destination.writableEnded).toBe(false);
    expect(fixture.logging.requestId()).toBeUndefined();
    expectSecretsAbsent(fixture.output.text());
  });
});
