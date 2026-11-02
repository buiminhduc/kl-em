import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';
import { PinoLogger } from 'nestjs-pino';
import {
  BookingRuleError,
  IdempotencyKeyMismatchError,
  NoSlotAvailableError,
  NotFoundError,
} from '../scheduling/errors';
import type { ErrorResponseDto } from './error-response.dto';

/**
 * Maps every error to the design's error body {statusCode, error, message, requestId}.
 * Domain errors → 404 / 409 / 422; Nest HttpExceptions (e.g. ValidationPipe 400) keep their status;
 * anything else is a 500 and is logged.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: PinoLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const req = ctx.getRequest<Request & { id?: string }>();
    const res = ctx.getResponse<Response>();
    const { status, message } = this.describe(exception);
    if (status >= 500) {
      if (exception instanceof HttpException) {
        // Expected, already-classified failures (e.g. 503 from /health when Postgres is down):
        // warn with status and message only, no stack trace.
        this.logger.warn({ statusCode: status, message }, 'request failed');
      } else {
        // A real bug or infrastructure error: full error with stack, server-side only.
        this.logger.error({ err: exception }, 'unhandled error');
      }
    }
    const body: ErrorResponseDto = {
      statusCode: status,
      error: STATUS_CODES[status] ?? 'Error',
      message,
      requestId: String(req.id ?? ''),
    };
    res.status(status).json(body);
  }

  private describe(e: unknown): { status: number; message: string } {
    if (e instanceof NotFoundError) return { status: HttpStatus.NOT_FOUND, message: e.message };
    if (e instanceof BookingRuleError)
      return { status: HttpStatus.UNPROCESSABLE_ENTITY, message: e.message };
    if (e instanceof NoSlotAvailableError || e instanceof IdempotencyKeyMismatchError) {
      return { status: HttpStatus.CONFLICT, message: e.message };
    }
    if (e instanceof HttpException) {
      const r = e.getResponse();
      const raw = typeof r === 'string' ? r : (r as { message?: string | string[] }).message;
      const message = Array.isArray(raw) ? raw.join('; ') : (raw ?? e.message);
      return { status: e.getStatus(), message };
    }
    return { status: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Internal server error' };
  }
}
