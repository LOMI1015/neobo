import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import { Writable } from 'node:stream';
import type { LoggerService } from '@nestjs/common';
import pino from 'pino';
import type { DestinationStream, Logger } from 'pino';
import type * as PinoPretty from 'pino-pretty';
import { consoleColorsEnabled } from './console-display.js';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

const messages = {
  'http.completed': 'HTTP 请求已完成',
  'http.error': 'HTTP 请求处理失败',
  'framework.log': '框架运行事件',
  'server.listening': 'API 已开始监听，健康检查路径 /api/health',
  'server.startup_failed': 'API 启动失败',
  'server.stopped': 'API 已停止',
} as const;

export type LogEvent = keyof typeof messages;

export interface LogFields {
  readonly requestId?: string;
  readonly method?: string;
  readonly route?: string;
  readonly statusCode?: number;
  readonly durationMs?: number;
  readonly outcome?: 'success' | 'failure' | 'cancelled';
  readonly errorCode?: LogErrorCode;
  readonly host?: string;
  readonly port?: number;
}

export interface RuntimeLogging {
  readonly pino: Logger;
  readonly nest: LoggerService;
  readonly diagnostics: Readonly<{ droppedRecords: number; outputFailures: number }>;
  write(level: LogLevel, event: LogEvent, fields?: LogFields): void;
  run<T>(requestId: string, callback: () => T): T;
  requestId(): string | undefined;
  close(): Promise<void>;
}

const errorCodes = [
  'HTTP_BAD_REQUEST',
  'HTTP_UNAUTHORIZED',
  'HTTP_FORBIDDEN',
  'HTTP_NOT_FOUND',
  'HTTP_METHOD_NOT_ALLOWED',
  'HTTP_CONFLICT',
  'HTTP_PAYLOAD_TOO_LARGE',
  'HTTP_UNSUPPORTED_MEDIA_TYPE',
  'HTTP_UNPROCESSABLE_ENTITY',
  'HTTP_TOO_MANY_REQUESTS',
  'HTTP_INTERNAL_ERROR',
  'HTTP_SERVICE_UNAVAILABLE',
  'HTTP_REQUEST_FAILED',
  'HTTP_SERVER_ERROR',
  'HTTP_REQUEST_CANCELLED',
  'STARTUP_FAILED',
] as const;
export type LogErrorCode = (typeof errorCodes)[number];

function validErrorCode(value: unknown): value is LogErrorCode {
  return errorCodes.some((code) => code === value);
}
const methods = new Set([
  'GET',
  'HEAD',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'OPTIONS',
  'CONNECT',
  'TRACE',
]);
const require = createRequire(import.meta.url);

// 只读自身数据属性，避免日志触发外部对象的 getter、toJSON 或代理异常。
function dataProperty(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null) return undefined;
  try {
    return Object.getOwnPropertyDescriptor(value, key)?.value;
  } catch {
    return undefined;
  }
}

function validRequestId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(value);
}

function safeFields(value: unknown): LogFields {
  const fields: {
    requestId?: string;
    method?: string;
    route?: string;
    statusCode?: number;
    durationMs?: number;
    outcome?: 'success' | 'failure' | 'cancelled';
    errorCode?: LogErrorCode;
    host?: string;
    port?: number;
  } = {};
  const requestId = dataProperty(value, 'requestId');
  if (validRequestId(requestId)) fields.requestId = requestId;
  const method = dataProperty(value, 'method');
  if (typeof method === 'string' && methods.has(method)) fields.method = method;
  const route = dataProperty(value, 'route');
  if (
    typeof route === 'string' &&
    route.length <= 256 &&
    (route === '[unmatched]' || /^\/[A-Za-z0-9_/:.*(){}-]*$/.test(route))
  ) {
    fields.route = route;
  }
  const statusCode = dataProperty(value, 'statusCode');
  if (
    typeof statusCode === 'number' &&
    Number.isInteger(statusCode) &&
    statusCode >= 100 &&
    statusCode <= 599
  ) {
    fields.statusCode = statusCode;
  }
  const durationMs = dataProperty(value, 'durationMs');
  if (
    typeof durationMs === 'number' &&
    Number.isFinite(durationMs) &&
    durationMs >= 0 &&
    durationMs <= 86_400_000
  ) {
    fields.durationMs = Math.round(durationMs * 1000) / 1000;
  }
  const outcome = dataProperty(value, 'outcome');
  if (outcome === 'success' || outcome === 'failure' || outcome === 'cancelled')
    fields.outcome = outcome;
  const errorCode = dataProperty(value, 'errorCode');
  if (validErrorCode(errorCode)) fields.errorCode = errorCode;
  const host = dataProperty(value, 'host');
  if (typeof host === 'string' && /^[A-Za-z0-9.:[\]-]{1,253}$/.test(host)) fields.host = host;
  const port = dataProperty(value, 'port');
  if (typeof port === 'number' && Number.isInteger(port) && port >= 0 && port <= 65535)
    fields.port = port;
  return fields;
}

function safeEvent(value: unknown): LogEvent {
  return typeof value === 'string' && Object.hasOwn(messages, value)
    ? (value as LogEvent)
    : 'framework.log';
}

function packageVersion(): string {
  const manifest: unknown = require('../package.json');
  const version = dataProperty(manifest, 'version');
  if (typeof version !== 'string' || !/^[0-9A-Za-z.+-]{1,64}$/.test(version)) {
    throw new Error('API 版本信息无效。');
  }
  return version;
}

export function createRuntimeLogging(
  options: {
    readonly destination?: DestinationStream;
    readonly environment?: string;
    readonly closeTimeoutMs?: number;
  } = {},
): RuntimeLogging {
  const environment = options.environment ?? process.env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(environment)) {
    throw new Error('日志环境配置无效。');
  }
  const closeTimeoutMs = options.closeTimeoutMs ?? 1000;
  if (!Number.isInteger(closeTimeoutMs) || closeTimeoutMs < 1 || closeTimeoutMs > 10_000) {
    throw new Error('日志关闭时限无效。');
  }

  let cleanup: (() => void) | undefined;
  try {
    const context = new AsyncLocalStorage<string | undefined>();
    const diagnostics = { droppedRecords: 0, outputFailures: 0 };
    let outputFailed = false;
    let warned = false;
    let closed = false;
    let pendingWrites = 0;
    let writesSettled: (() => void) | undefined;
    let outputListenersAttached = true;
    let closePromise: Promise<void> | undefined;
    const signalFailure = (): void => {
      diagnostics.outputFailures += 1;
      outputFailed = true;
      if (warned) return;
      warned = true;
      try {
        process.stderr.write('API 日志输出不可用，部分运行日志可能丢失。\n');
      } catch {
        // 标准错误也不可用时只计数，不能递归写日志或影响请求结果。
        diagnostics.outputFailures += 1;
      }
    };
    const signalDrop = (): void => {
      diagnostics.droppedRecords += 1;
      if (warned) return;
      warned = true;
      try {
        process.stderr.write('API 日志缓冲区已满，部分运行日志已丢弃。\n');
      } catch {
        diagnostics.outputFailures += 1;
      }
    };

    // 先加载格式化器再创建输出资源，初始化失败不会遗留流或退出监听器。
    let prettify: ((line: string) => string | undefined) | undefined;
    if (!options.destination && environment === 'development') {
      const prettyModule = require('pino-pretty') as typeof PinoPretty;
      prettify = prettyModule.prettyFactory({
        colorize: consoleColorsEnabled(process.env, process.stdout.isTTY === true),
        translateTime: 'UTC:yyyy-mm-dd HH:MM:ss.l Z',
        singleLine: true,
        ignore: 'pid,hostname,schemaVersion,service,environment,version,instanceId',
      });
    }
    const version = packageVersion();
    const ownedDestination = options.destination
      ? undefined
      : pino.destination({
          dest: 1,
          sync: false,
          minLength: 0,
          maxLength: 65_536,
          maxWrite: 16_384,
          // 慢管道不能触发无限重试；失败后由固定降级信号和计数暴露。
          retryEAGAIN: () => false,
        });
    const destination = options.destination ?? ownedDestination;
    if (!destination) throw new Error('日志输出初始化失败。');
    // Pino 在 EPIPE 后会替换 end/destroy，提前保留官方资源释放方法。
    const endOwned = ownedDestination?.end.bind(ownedDestination);
    const destroyOwned = ownedDestination?.destroy.bind(ownedDestination);
    if (destination instanceof EventEmitter) {
      destination.on('error', signalFailure);
      destination.on('drop', signalDrop);
    }
    cleanup = () => {
      if (destination instanceof EventEmitter) {
        destination.off('error', signalFailure);
        destination.off('drop', signalDrop);
      }
      destroyOwned?.();
      context.disable();
    };

    const logger = pino(
      {
        level: 'info',
        base: {
          schemaVersion: 1,
          service: 'neobo-api',
          environment,
          version,
          instanceId: randomUUID(),
        },
        timestamp: pino.stdTimeFunctions.isoTime,
        redact: {
          paths: [
            'password',
            'token',
            'apiKey',
            'authorization',
            'cookie',
            'connectionString',
            'req',
            'res',
            'err',
            'error',
            'stack',
            'body',
            'prompt',
            '*.password',
            '*.token',
            '*.apiKey',
            '*.authorization',
            '*.cookie',
          ],
          remove: true,
        },
        hooks: {
          logMethod(args, method) {
            if (closed) return;
            const input: unknown = args[0];
            const event = safeEvent(dataProperty(input, 'event'));
            const fields = safeFields(input);
            const requestId = context.getStore();
            const record = { ...fields, ...(requestId ? { requestId } : {}), event };
            method.apply(this, [record, messages[event]]);
          },
        },
      },
      {
        write(line) {
          if (outputFailed) {
            diagnostics.droppedRecords += 1;
            return;
          }
          try {
            // 过滤后的 JSON 每行有界；prettyFactory 同步格式化，不引入额外队列。
            const output = prettify ? prettify(line) : line;
            if (output && destination instanceof Writable) {
              pendingWrites += 1;
              destination.write(output, (error?: Error | null) => {
                if (error) {
                  signalFailure();
                  if (!outputListenersAttached) {
                    // 调用方流可能在关闭超时后才回调；仅接住紧随回调的 error 事件。
                    const lateError = (): void => undefined;
                    destination.once('error', lateError);
                    setImmediate(() => destination.off('error', lateError));
                  }
                }
                pendingWrites -= 1;
                if (pendingWrites === 0) writesSettled?.();
              });
            } else if (output) {
              destination.write(output);
            }
          } catch {
            diagnostics.droppedRecords += 1;
            signalFailure();
          }
        },
      },
    );

    const originalChild = logger.child.bind(logger);
    const secureChild = (): Logger => {
      // 请求标识仅走上下文或显式字段；从根创建，防止重复键及子配置取消脱敏。
      const child = originalChild<never>({});
      protectBindings(child);
      return child;
    };
    const protectBindings = (target: Logger): void => {
      Object.defineProperty(target, 'child', { value: secureChild });
      // Pino 的 setBindings 只能追加，禁用该入口以保证字段与行长度上限。
      Object.defineProperty(target, 'setBindings', { value: () => undefined });
    };
    protectBindings(logger);

    const write: RuntimeLogging['write'] = (level, event, fields) => {
      logger[level]({ ...safeFields(fields), event: safeEvent(event) });
    };
    const nest: LoggerService = {
      log: () => write('info', 'framework.log'),
      error: () => write('error', 'framework.log'),
      warn: () => write('warn', 'framework.log'),
      debug: () => write('debug', 'framework.log'),
      verbose: () => write('trace', 'framework.log'),
      fatal: () => write('fatal', 'framework.log'),
    };

    const close = (): Promise<void> => {
      if (closePromise) return closePromise;
      closed = true;
      context.disable();
      closePromise = new Promise<void>((resolve) => {
        if (!ownedDestination) {
          let finished = false;
          const finish = (): void => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            writesSettled = undefined;
            // Writable 先回调再发出 error，留到下一轮移除监听，避免关闭时未处理异常。
            setImmediate(() => {
              if (destination instanceof EventEmitter) {
                destination.off('error', signalFailure);
                destination.off('drop', signalDrop);
              }
              outputListenersAttached = false;
              resolve();
            });
          };
          const timer = setTimeout(() => {
            signalFailure();
            finish();
          }, closeTimeoutMs);
          writesSettled = finish;
          if (pendingWrites === 0) finish();
          return;
        }
        const finish = (): void => {
          clearTimeout(timer);
          ownedDestination.off('close', finish);
          resolve();
        };
        const timer = setTimeout(() => {
          signalFailure();
          destroyOwned?.();
          finish();
        }, closeTimeoutMs);
        ownedDestination.once('close', finish);
        try {
          // SonicBoom 释放自有状态，stdout/stderr 的文件描述符保持打开。
          endOwned?.();
        } catch {
          signalFailure();
          destroyOwned?.();
          finish();
        }
      });
      return closePromise;
    };

    return {
      pino: logger,
      nest,
      diagnostics,
      write,
      run: (requestId, callback) =>
        context.run(validRequestId(requestId) ? requestId : undefined, callback),
      requestId: () => context.getStore(),
      close,
    };
  } catch {
    try {
      cleanup?.();
    } catch {
      throw new Error('日志初始化失败，输出资源释放失败。');
    }
    throw new Error('日志初始化失败。');
  }
}
