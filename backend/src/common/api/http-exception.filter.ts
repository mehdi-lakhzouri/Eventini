import {
  Catch,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import { AppException } from './app-exception';
import { buildProblemDetails } from './build-problem-details';
import { buildResponseMeta } from './build-response-meta';
import { isServerError, mapUnknownException } from './map-unknown-exception';
import type { ApiEnvelope, ProblemDetails } from './problem-details.types';
import type { RequestWithId } from '../types/request-with-id';

const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';

/**
 * The single place that turns any thrown value into the RFC 9457 error
 * shape. Every controller lets exceptions propagate here rather than
 * catching and formatting them locally — one filter means one shape,
 * guaranteed, instead of each route reinventing it slightly differently.
 *
 * Logs exactly once, at the boundary. A controller that also logs the same
 * exception turns one incident into several log lines and makes error
 * counts lie.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const instance = request.originalUrl ?? request.url;

    const problem: ProblemDetails =
      exception instanceof AppException
        ? buildProblemDetails(exception.code, instance, {
            detail: exception.detail,
            errors: exception.errors,
            retryable: exception.retryable,
          })
        : mapUnknownException(exception, instance);

    this.logOnce(problem, request, exception);

    const envelope: ApiEnvelope<null> = {
      data: null,
      meta: buildResponseMeta(request.id),
      error: problem,
    };

    response
      .status(problem.status)
      .contentType(PROBLEM_JSON_CONTENT_TYPE)
      .json(envelope);
  }

  private logOnce(
    problem: ProblemDetails,
    request: RequestWithId,
    exception: unknown,
  ): void {
    const context = `${request.method} ${request.originalUrl ?? request.url} -> ${problem.status} ${problem.code} [${request.id}]`;

    if (isServerError(problem)) {
      // The stack is server-side only — it never reaches `problem.detail`,
      // which is what the client sees.
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(context, stack);
      return;
    }

    this.logger.warn(context);
  }
}
