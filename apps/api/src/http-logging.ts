import { performance } from 'node:perf_hooks';
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LogErrorCode, RuntimeLogging } from './logging.js';

const errorCodes = new Map<number, LogErrorCode>([
  [400, 'HTTP_BAD_REQUEST'],
  [401, 'HTTP_UNAUTHORIZED'],
  [403, 'HTTP_FORBIDDEN'],
  [404, 'HTTP_NOT_FOUND'],
  [405, 'HTTP_METHOD_NOT_ALLOWED'],
  [409, 'HTTP_CONFLICT'],
  [413, 'HTTP_PAYLOAD_TOO_LARGE'],
  [415, 'HTTP_UNSUPPORTED_MEDIA_TYPE'],
  [422, 'HTTP_UNPROCESSABLE_ENTITY'],
  [429, 'HTTP_TOO_MANY_REQUESTS'],
  [500, 'HTTP_INTERNAL_ERROR'],
  [503, 'HTTP_SERVICE_UNAVAILABLE'],
]);

export function errorCodeForStatus(statusCode: number): LogErrorCode {
  return (
    errorCodes.get(statusCode) ?? (statusCode >= 500 ? 'HTTP_SERVER_ERROR' : 'HTTP_REQUEST_FAILED')
  );
}

export function requestRoute(request: FastifyRequest): string {
  // 路由模板来自注册配置；找不到路由时不能回退到含用户数据的 URL。
  return request.routeOptions.url ?? '[unmatched]';
}

function createCompletion(
  logging: RuntimeLogging,
  request: FastifyRequest,
  reply: FastifyReply,
  route: string,
  onComplete?: () => void,
): () => void {
  const start = performance.now();
  let completed = false;
  const complete = (cancelled: boolean): void => {
    if (completed) return;
    completed = true;
    reply.raw.off('finish', onFinish);
    reply.raw.off('close', onClose);
    onComplete?.();
    // 未发出响应头就断开时，没有可信状态码，不能把默认的 200 当成结果。
    const statusCode = cancelled && !reply.raw.headersSent ? undefined : reply.statusCode;
    const failed = statusCode !== undefined && statusCode >= 400;
    const errorCode = cancelled
      ? 'HTTP_REQUEST_CANCELLED'
      : failed
        ? errorCodeForStatus(statusCode)
        : undefined;
    logging.write(
      cancelled
        ? 'warn'
        : statusCode !== undefined && statusCode >= 500
          ? 'error'
          : failed
            ? 'warn'
            : 'info',
      'http.completed',
      {
        requestId: request.id,
        method: request.method,
        route,
        ...(statusCode === undefined ? {} : { statusCode }),
        durationMs: Math.max(0, performance.now() - start),
        outcome: cancelled ? 'cancelled' : failed ? 'failure' : 'success',
        ...(errorCode ? { errorCode } : {}),
      },
    );
  };
  const onFinish = (): void => complete(false);
  const onClose = (): void => {
    if (!reply.raw.writableFinished) complete(true);
  };
  // 普通响应、路由解析失败与连接中断共用终态，释放监听并防止重复摘要。
  reply.raw.once('finish', onFinish);
  reply.raw.once('close', onClose);
  return () => {
    // onResponse 也可能由写入错误触发；未完成时由 finish/close 判定终态。
    if (reply.raw.writableFinished) complete(false);
  };
}

export function handleFrameworkError(
  error: FastifyError,
  request: FastifyRequest,
  reply: FastifyReply,
  logging: RuntimeLogging,
): void {
  const statusCode =
    error.code === 'FST_ERR_BAD_URL' ? 400 : error.code === 'FST_ERR_MAX_PARAM_LENGTH' ? 414 : 500;
  const code = errorCodeForStatus(statusCode);
  // 路由解析失败先于普通 hooks，必须独立补充响应标识和完成摘要。
  createCompletion(logging, request, reply, '[unmatched]');
  logging.run(request.id, () => {
    if (statusCode >= 500) {
      logging.write('error', 'http.error', {
        requestId: request.id,
        method: request.method,
        route: '[unmatched]',
        statusCode,
        errorCode: code,
        outcome: 'failure',
      });
    }
    void reply
      .header('X-Request-Id', request.id)
      .status(statusCode)
      .send({
        statusCode,
        code,
        message: statusCode >= 500 ? 'Internal server error' : 'Request failed',
        requestId: request.id,
      });
  });
}

export function registerHttpLogging(fastify: FastifyInstance, logging: RuntimeLogging): void {
  const completions = new WeakMap<FastifyRequest, () => void>();

  fastify.addHook('onRequest', (request, reply, done) => {
    completions.set(
      request,
      createCompletion(logging, request, reply, requestRoute(request), () => {
        completions.delete(request);
      }),
    );
    reply.header('X-Request-Id', request.id);
    // 在回调形式的 hook 内继续链路，使后续解析、控制器及异步服务继承上下文。
    logging.run(request.id, done);
  });

  fastify.addHook('onResponse', (request, reply, done) => {
    completions.get(request)?.();
    done();
  });
}
