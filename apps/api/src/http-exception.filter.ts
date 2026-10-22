import { Catch, HttpException } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const statusCode = exception instanceof HttpException ? exception.getStatus() : 500;
    void reply.status(statusCode).send({
      statusCode,
      message: statusCode >= 500 ? 'Internal server error' : 'Request failed',
    });
  }
}
