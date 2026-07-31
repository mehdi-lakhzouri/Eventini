import {
  Catch,
  Injectable,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { AppException } from './app-exception';
import { buildProblemDetails } from './build-problem-details';
import { buildResponseMeta } from './build-response-meta';
import { isServerError, mapUnknownException } from './map-unknown-exception';
import type { ApiEnvelope, ProblemDetails } from './problem-details.types';
import { stripQueryString } from './strip-query-string';
// Imported from the file, not the barrel: `infrastructure/metrics`'s barrel
// pulls in `MetricsController`, which imports `@RawResponse()` from this
// directory's barrel. Going through both would make `common/api` and
// `infrastructure/metrics` circular, and TypeScript resolves one side of a
// cycle to `any` — which is how this arrived as "unsafe member access" rather
// than as an obvious import error.
import { MetricsService } from '../../infrastructure/metrics/metrics.service';
import type { RequestWithId } from '../types/request-with-id';

const PROBLEM_JSON_CONTENT_TYPE = 'application/problem+json';

/**
 * The single place that turns any thrown value into the RFC 9457 error
 * shape. Every controller lets exceptions propagate here rather than
 * catching and formatting them locally — one filter means one shape,
 * guaranteed, instead of each route reinventing it slightly differently.
 *
 * Logs exactly once, at the boundary — PINO_LOGGING_SPECIFICATION.md §3.4
 * and §28. A controller that also logs the same exception turns one incident
 * into four log lines and makes every error count wrong.
 *
 * Injectable rather than `new`-ed in `main.ts`: `PinoLogger` resolves the
 * request-scoped child logger from `AsyncLocalStorage`, so the line written
 * here already carries the `requestId` and tenant context the rest of the
 * request logged under. BACKEND_ARCHITECTURE.md §4 sketches
 * `useGlobalFilters(new HttpExceptionFilter())`, which predates the logger
 * existing; it is registered as an `APP_FILTER` provider instead, which is
 * the same global filter with its dependencies satisfied.
 */
@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(
    private readonly logger: PinoLogger,
    private readonly metricsService: MetricsService,
  ) {
    this.logger.setContext('HttpExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();
    const instance = stripQueryString(request.originalUrl ?? request.url);

    const problem: ProblemDetails =
      exception instanceof AppException
        ? buildProblemDetails(exception.code, instance, {
            detail: exception.detail,
            errors: exception.errors,
            retryable: exception.retryable,
          })
        : mapUnknownException(exception, instance);

    this.logOnce(problem, request, exception);
    this.countOnce(problem);

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

  /**
   * Drives `application_errors_total` (§36).
   *
   * Labelled with `category` and `eventCode` only — both drawn from the same
   * small closed sets the log line uses, so the series count is bounded by
   * their product. `errorCode` is deliberately absent even though it would be
   * useful: the catalogue has 37 entries today and grows with every feature,
   * and multiplying that across categories is the kind of quiet growth §36
   * warns about. The log line carries `errorCode`, which is where a specific
   * failure gets investigated; the metric answers "how many, and is it
   * getting worse".
   */
  private countOnce(problem: ProblemDetails): void {
    this.metricsService.metrics.applicationErrorsTotal.inc({
      category: isServerError(problem) ? 'APPLICATION' : 'HTTP_ACCESS',
      eventCode: isServerError(problem)
        ? 'UNHANDLED_APPLICATION_ERROR'
        : 'HTTP_REQUEST_FAILED',
    });
  }

  private logOnce(
    problem: ProblemDetails,
    request: RequestWithId,
    exception: unknown,
  ): void {
    // `requestId` is not set here: `pino-http`'s `customProps` binds it onto
    // the per-request child logger, so it is already on this line. Setting it
    // again would emit the key twice.
    const fields = {
      category: isServerError(problem) ? 'APPLICATION' : 'HTTP_ACCESS',
      eventCode: isServerError(problem)
        ? 'UNHANDLED_APPLICATION_ERROR'
        : 'HTTP_REQUEST_FAILED',
      errorCode: problem.code,
      result: 'FAILURE',
      operation: `${request.method} ${problem.instance}`,
    };

    if (isServerError(problem)) {
      // `err` goes through the error serializer, which keeps the stack — this
      // object is written to the log store, which is server-side. What the
      // client receives is `problem.detail`, which never contains it.
      this.logger.error({ ...fields, err: exception }, 'Request failed');
      return;
    }

    // Expected 4xx: the API refusing something correctly. §19 keeps these
    // at a level that does not imply an operator needs to act.
    this.logger.warn(fields, 'Request rejected');
  }
}
