import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Normalizes every error response into an RFC 7807 "Problem Details" shape:
 * { type, title, status, detail, instance, timestamp }
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const isHttpException = exception instanceof HttpException;
    const status = isHttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    const body = isHttpException ? exception.getResponse() : null;
    const detail =
      typeof body === 'string'
        ? body
        : (body as any)?.message ?? (exception as Error)?.message ?? 'Internal server error';

    response.status(status).json({
      type: `https://vtrack.pro/errors/${status}`,
      title: HttpStatus[status] ?? 'Error',
      status,
      detail,
      instance: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
