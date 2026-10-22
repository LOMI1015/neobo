import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import pino from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRuntimeLogging } from '../src/logging.js';
import type { RuntimeLogging } from '../src/logging.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function capture() {
  let output = '';
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      output += chunk.toString('utf8');
      callback();
    },
  });
  return {
    destination,
    output: () => output,
    records: () =>
      output
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const value: unknown = JSON.parse(line);
          if (!isRecord(value)) throw new Error('日志不是 JSON 对象。');
          return value;
        }),
  };
}

describe('controlled runtime logging', () => {
  const loggers: RuntimeLogging[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    await Promise.all(loggers.splice(0).map((logging) => logging.close()));
    vi.restoreAllMocks();
    await Promise.all(
      directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
    vi.unstubAllEnvs();
  });

  function create(options: Parameters<typeof createRuntimeLogging>[0] = {}) {
    const logging = createRuntimeLogging(options);
    loggers.push(logging);
    return logging;
  }

  it('uses UTC, service metadata and the same Pino instance for Nest events', async () => {
    const sink = capture();
    const logging = create({ destination: sink.destination, environment: 'production' });
    logging.write('info', 'server.listening', { host: '127.0.0.1', port: 3000 });
    logging.nest.log('Starting application', 'NestFactory');
    logging.nest.error(new Error('postgresql://user:synthetic-secret@localhost/neobo'));
    await logging.close();

    const records = sink.records();
    expect(records).toHaveLength(3);
    expect(records[0]).toMatchObject({
      schemaVersion: 1,
      service: 'neobo-api',
      environment: 'production',
      version: '0.0.0',
      event: 'server.listening',
      host: '127.0.0.1',
      port: 3000,
      level: 30,
    });
    expect(records[0]?.time).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(records.every((record) => record.instanceId === records[0]?.instanceId)).toBe(true);
    expect(records[1]).toMatchObject({ event: 'framework.log', msg: '框架运行事件', level: 30 });
    expect(records[2]).toMatchObject({ event: 'framework.log', msg: '框架运行事件', level: 50 });
    expect(sink.output()).not.toContain('Starting application');
    expect(sink.output()).not.toContain('synthetic-secret');
    expect(sink.destination.destroyed).toBe(false);
    expect(sink.destination.listenerCount('error')).toBe(0);
  });

  it('does not serialize request bodies, credentials, SQL, AI text or raw error causes', () => {
    const sink = capture();
    const logging = create({ destination: sink.destination, environment: 'test' });
    const secret = 'synthetic-sensitive-token-8c2f';
    const error = new Error(`postgresql://user:${secret}@localhost/neobo`, {
      cause: new Error(`SELECT * FROM private WHERE token='${secret}'`),
    });
    logging.pino.error(
      {
        event: 'http.error',
        method: 'POST',
        route: '/api/items/:id',
        statusCode: 500,
        errorCode: 'HTTP_INTERNAL_ERROR',
        req: { headers: { authorization: `Bearer ${secret}`, cookie: secret }, body: { secret } },
        res: { body: secret },
        err: error,
        password: secret,
        token: secret,
        apiKey: secret,
        connectionString: secret,
        body: secret,
        prompt: secret,
        conversation: secret,
        sql: secret,
        nested: { cause: { password: secret } },
        msg: secret,
      },
      secret,
      { secret },
    );
    logging.nest.error(error, error.stack, secret);
    logging.pino.error(error);

    expect(sink.records()).toHaveLength(3);
    expect(sink.records()[0]).toMatchObject({
      event: 'http.error',
      route: '/api/items/:id',
      errorCode: 'HTTP_INTERNAL_ERROR',
    });
    expect(sink.output()).not.toContain(secret);
    expect(sink.output()).not.toContain('postgresql://');
    expect(sink.output()).not.toContain('SELECT');
    expect(sink.output()).not.toContain('stack');
    expect(sink.output()).not.toContain('authorization');
  });

  it('never invokes unknown getters or serialization hooks, including throwing proxies', () => {
    const sink = capture();
    const logging = create({ destination: sink.destination, environment: 'test' });
    const getter = vi.fn(() => {
      throw new Error('synthetic-getter-secret');
    });
    const input = Object.defineProperties(
      {},
      {
        event: { get: getter },
        requestId: { get: getter },
        method: { get: getter },
        route: { get: getter },
        statusCode: { get: getter },
        durationMs: { get: getter },
        outcome: { get: getter },
        errorCode: { get: getter },
        host: { get: getter },
        port: { get: getter },
        toJSON: { value: getter },
      },
    );
    const proxyTrap = vi.fn(() => {
      throw new Error('synthetic-proxy-secret');
    });
    const proxy = new Proxy(
      {},
      { getOwnPropertyDescriptor: proxyTrap, ownKeys: proxyTrap, get: proxyTrap },
    );
    expect(() => {
      logging.pino.info(input);
      logging.pino.error(proxy);
      logging.pino.child(input).info(proxy);
      logging.pino.setBindings(input);
      logging.write('info', 'framework.log', input);
    }).not.toThrow();
    // 普通对象的 getter 不运行；Proxy 的 descriptor 陷阱失败也安全丢弃。
    expect(getter).not.toHaveBeenCalled();
    expect(proxyTrap).toHaveBeenCalled();
    expect(sink.records()).toHaveLength(4);
    expect(sink.output()).not.toContain('synthetic-getter-secret');
  });

  it('keeps child bindings, custom formatters and repeated setBindings from bypassing safety', () => {
    const sink = capture();
    const logging = create({ destination: sink.destination, environment: 'test' });
    const secret = 'synthetic-child-secret';
    const customFormatter = vi.fn(() => ({ password: secret }));
    let child = logging.pino.child(
      { password: secret, req: { body: secret } },
      {
        redact: [],
        msgPrefix: secret,
        serializers: { event: () => secret },
        formatters: { bindings: customFormatter, log: customFormatter },
      },
    );
    for (let index = 0; index < 200; index += 1) {
      child.setBindings({ password: secret, repeated: secret });
      child = child.child({ password: secret, requestId: 'server-generated-id' });
    }
    child.info(secret);
    expect(customFormatter).not.toHaveBeenCalled();
    expect(sink.output()).not.toContain(secret);
    expect(sink.records()[0]).toMatchObject({ event: 'framework.log' });
    expect(sink.records()[0]).not.toHaveProperty('requestId');
    expect(Buffer.byteLength(sink.output())).toBeLessThan(2048);
    expect(JSON.stringify(child.bindings())).not.toContain(secret);
  });

  it('enforces field limits and keeps complete JSON lines smaller than 2 KiB', () => {
    const sink = capture();
    const logging = create({ destination: sink.destination, environment: 'test' });
    logging.pino.info({
      event: 'http.completed',
      requestId: 'r'.repeat(64),
      method: 'GET',
      route: `/${'a'.repeat(255)}`,
      host: 'a'.repeat(253),
      port: 65535,
      durationMs: 86_400_000,
      statusCode: 599,
      outcome: 'cancelled',
      errorCode: 'HTTP_SERVER_ERROR',
      huge: 'sensitive'.repeat(100_000),
    });
    logging.pino.info({
      event: 'http.completed',
      requestId: 'r'.repeat(65),
      method: 'SECRET',
      route: '/api/items?token=synthetic-secret',
      host: 'https://user:password@example.com',
      port: 65536,
      statusCode: 600,
      durationMs: Infinity,
      outcome: 'secret',
      errorCode: 'UNTRUSTED_ERROR_SECRET',
    });
    for (const line of sink.output().trim().split('\n'))
      expect(Buffer.byteLength(line)).toBeLessThan(2048);
    expect(sink.records()[0]).toMatchObject({ requestId: 'r'.repeat(64), durationMs: 86_400_000 });
    expect(sink.records()[1]).not.toHaveProperty('requestId');
    expect(sink.records()[1]).not.toHaveProperty('route');
    expect(sink.records()[1]).not.toHaveProperty('host');
    expect(sink.records()[1]).not.toHaveProperty('durationMs');
    expect(sink.records()[1]).not.toHaveProperty('errorCode');
    expect(sink.output()).not.toContain('synthetic-secret');
  });

  it('isolates concurrent and nested asynchronous contexts without leaking after completion', async () => {
    const sink = capture();
    const logging = create({ destination: sink.destination, environment: 'test' });
    await Promise.all(
      ['first', 'second'].map((requestId) =>
        logging.run(requestId, async () => {
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(logging.requestId()).toBe(requestId);
          logging.write('info', 'framework.log');
          await logging.run('nested', async () => {
            await Promise.resolve();
            expect(logging.requestId()).toBe('nested');
          });
          expect(logging.requestId()).toBe(requestId);
        }),
      ),
    );
    expect(logging.requestId()).toBeUndefined();
    expect(
      sink
        .records()
        .map((record) => record.requestId)
        .sort(),
    ).toEqual(['first', 'second']);
    logging.run('malicious\nrequestId', () => expect(logging.requestId()).toBeUndefined());
  });

  it('keeps sync and async output failures away from requests and reports only a fixed signal', async () => {
    const warning = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const failing = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() =>
          callback(new Error('postgresql://user:synthetic-output-secret@localhost/neobo')),
        );
      },
    });
    const logging = create({ destination: failing, environment: 'test' });
    expect(() => logging.write('info', 'framework.log')).not.toThrow();
    await logging.close();
    expect(logging.diagnostics.outputFailures).toBeGreaterThan(0);
    expect(warning).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(warning.mock.calls)).not.toContain('synthetic-output-secret');

    const sync = create({
      destination: {
        write() {
          throw new Error('synthetic-sync-secret');
        },
      },
      environment: 'test',
    });
    expect(() => sync.write('info', 'framework.log')).not.toThrow();
    expect(() => sync.write('info', 'framework.log')).not.toThrow();
    expect(sync.diagnostics).toEqual({ outputFailures: 1, droppedRecords: 2 });
  });

  it('bounds close for a stalled caller-owned Writable without ending or destroying it', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    let complete: (() => void) | undefined;
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        complete = callback;
      },
    });
    const logging = create({ destination, environment: 'test', closeTimeoutMs: 20 });
    logging.write('info', 'framework.log');
    const first = logging.close();
    expect(logging.close()).toBe(first);
    await first;
    expect(logging.diagnostics.outputFailures).toBeGreaterThanOrEqual(1);
    expect(destination.destroyed).toBe(false);
    expect(destination.writableEnded).toBe(false);
    expect(destination.listenerCount('error')).toBe(0);
    complete?.();
    destination.destroy();
  });

  it('handles a Writable error after the close deadline without retaining listeners', async () => {
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    let complete: ((error: Error) => void) | undefined;
    const destination = new Writable({
      write(_chunk, _encoding, callback) {
        complete = callback;
      },
    });
    const logging = create({ destination, environment: 'test', closeTimeoutMs: 10 });
    logging.write('info', 'framework.log');
    await logging.close();
    expect(destination.listenerCount('error')).toBe(0);
    complete?.(new Error('synthetic-late-output-secret'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(logging.diagnostics.outputFailures).toBeGreaterThan(1);
    expect(destination.listenerCount('error')).toBe(0);
    destination.destroy();
  });

  it('counts dropped output and releases the bounded default destination on close', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'neobo-log-core-'));
    directories.push(directory);
    const path = join(directory, 'output.log');
    const createDestination = pino.destination;
    const destinationSpy = vi.spyOn(pino, 'destination').mockImplementation((options) => {
      expect(options).toMatchObject({ sync: false, maxLength: 65_536, maxWrite: 16_384 });
      return createDestination({ dest: path, sync: false, maxLength: 65_536, minLength: 0 });
    });
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const logging = create({ environment: 'test' });
    for (let index = 0; index < 1000; index += 1) logging.write('info', 'framework.log');
    expect(logging.diagnostics.droppedRecords).toBeGreaterThan(0);
    await logging.close();
    expect(destinationSpy).toHaveBeenCalledOnce();
    const output = await readFile(path, 'utf8');
    expect(output.length).toBeLessThanOrEqual(65_536);
    expect(output).toContain('framework.log');
    const before = output;
    logging.write('info', 'framework.log');
    expect(await readFile(path, 'utf8')).toBe(before);
    expect(process.stdout.destroyed).toBe(false);
  });

  it('bounds owned destination shutdown and safely handles owned output faults', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'neobo-log-fault-'));
    directories.push(directory);
    const owned = pino.destination({ dest: join(directory, 'output.log'), sync: false });
    await new Promise<void>((resolve) => owned.once('ready', resolve));
    vi.spyOn(pino, 'destination').mockReturnValue(owned);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    vi.spyOn(owned, 'write').mockImplementation(() => {
      owned.emit(
        'error',
        Object.assign(new Error('synthetic-owned-fault-secret'), { code: 'EPIPE' }),
      );
      return false;
    });
    // 模拟官方输出未能排空，关闭时限必须释放其资源。
    vi.spyOn(owned, 'end').mockImplementation(() => undefined);
    const destroy = vi.spyOn(owned, 'destroy');
    const closed = new Promise<void>((resolve) => owned.once('close', resolve));
    const logging = create({ environment: 'test', closeTimeoutMs: 10 });
    expect(() => logging.write('info', 'framework.log')).not.toThrow();
    expect(logging.diagnostics.outputFailures).toBe(1);
    await logging.close();
    await closed;
    expect(destroy).toHaveBeenCalledOnce();
    expect(logging.diagnostics.outputFailures).toBeGreaterThanOrEqual(2);
    expect(process.stdout.destroyed).toBe(false);
  });

  it('does not include raw external errors in its fallback signal', async () => {
    const warning = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const destination = Object.assign(new EventEmitter(), { write: vi.fn() });
    const logging = create({ destination, environment: 'test' });
    destination.emit('error', new Error('synthetic-event-secret'));
    logging.write('info', 'framework.log');
    expect(destination.write).not.toHaveBeenCalled();
    expect(logging.diagnostics).toEqual({ outputFailures: 1, droppedRecords: 1 });
    expect(JSON.stringify(warning.mock.calls)).not.toContain('synthetic-event-secret');
    await logging.close();
    expect(destination.listenerCount('error')).toBe(0);
  });

  it('validates runtime configuration before creating an output resource', () => {
    const destination = vi.spyOn(pino, 'destination');
    expect(() => create({ environment: 'postgresql://synthetic-secret' })).toThrow(
      '日志环境配置无效',
    );
    expect(() => create({ closeTimeoutMs: Infinity })).toThrow('日志关闭时限无效');
    expect(destination).not.toHaveBeenCalled();
  });

  it('formats development output with the official prettifier and obeys NO_COLOR', async () => {
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('NEOBO_DEV_COLORS', '1');
    const directory = await mkdtemp(join(tmpdir(), 'neobo-log-pretty-'));
    directories.push(directory);
    const path = join(directory, 'output.log');
    const createDestination = pino.destination;
    vi.spyOn(pino, 'destination').mockImplementation(() =>
      createDestination({ dest: path, sync: false }),
    );
    const logging = create({ environment: 'development' });
    logging.write('info', 'server.listening', { host: '127.0.0.1', port: 3000 });
    await logging.close();
    const output = await readFile(path, 'utf8');
    expect(output).toContain('INFO');
    expect(output).toContain('/api/health');
    expect(output).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(output).not.toContain('\u001b[');
    expect(output.startsWith('{')).toBe(false);
  });

  it('starts production without loading the development prettifier', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'neobo-log-production-'));
    directories.push(directory);
    const createDestination = pino.destination;
    const destination = vi.spyOn(pino, 'destination').mockImplementation(() =>
      createDestination({
        dest: join(directory, 'output.log'),
        sync: false,
      }),
    );
    const modules: string[] = [];
    vi.doMock('node:module', () => ({
      createRequire: (url: string | URL) => {
        const load = createRequire(url);
        return (id: string): unknown => {
          modules.push(id);
          if (id === 'pino-pretty') throw new Error('synthetic-unavailable-prettifier-secret');
          return load(id);
        };
      },
    }));
    vi.resetModules();
    try {
      const isolated = await import('../src/logging.js');
      const logging = isolated.createRuntimeLogging({ environment: 'production' });
      loggers.push(logging);
      logging.write('info', 'server.stopped');
      await logging.close();
      expect(modules).toContain('../package.json');
      expect(modules).not.toContain('pino-pretty');
      expect(() => isolated.createRuntimeLogging({ environment: 'development' })).toThrow(
        '日志初始化失败',
      );
      expect(destination).toHaveBeenCalledOnce();
    } finally {
      vi.doUnmock('node:module');
      vi.resetModules();
    }
  });
});
