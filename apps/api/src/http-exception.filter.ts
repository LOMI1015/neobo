import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorCodeForStatus, requestRoute } from './http-logging.js';
import type { RuntimeLogging } from './logging.js';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logging: RuntimeLogging) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const request = context.getRequest<FastifyRequest>();
    const reply = context.getResponse<FastifyReply>();
    const exceptionStatus = exception instanceof HttpException ? exception.getStatus() : 500;
    const statusCode =
      Number.isInteger(exceptionStatus) && exceptionStatus >= 400 && exceptionStatus <= 599
        ? exceptionStatus
        : 500;
    const code = errorCodeForStatus(statusCode);
    if (statusCode >= 500) {
      // 异常原文、堆栈与 cause 可能含凭据，只记录受控分类和请求上下文。
      this.logging.write('error', 'http.error', {
        requestId: request.id,
        method: request.method,
        route: requestRoute(request),
        statusCode,
        errorCode: code,
        outcome: 'failure',
      });
    }
    void reply.status(statusCode).send({
      statusCode,
      code,
      message: statusCode >= 500 ? 'Internal server error' : 'Request failed',
      requestId: request.id,
    });
  }
}
