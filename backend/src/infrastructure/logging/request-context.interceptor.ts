import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';

import type { RequestWithId } from '../../common/types';
import { RequestContextService } from './request-context.service';

/** W3C `traceparent`: `version-traceId-spanId-flags`, hex, fixed widths. */
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

/**
 * Seeds the request-scoped logger with correlation fields — §11 and §12.
 *
 * `requestId` comes from `RequestIdMiddleware` (EVT-010), which has already
 * validated or replaced whatever the client sent. Reading `req.id` here
 * rather than the header again means the ID in the logs is guaranteed to be
 * the same one in `meta.requestId` and in the `X-Request-Id` response header.
 *
 * `traceId`/`spanId` are parsed from `traceparent` when a caller supplies a
 * well-formed one. §12 sequences OpenTelemetry after request-ID correlation,
 * so no SDK is wired up yet — but honouring an inbound `traceparent` costs a
 * regex and means logs emitted today can already be joined to a trace
 * collected upstream. A malformed value is ignored rather than passed
 * through: a `traceId` that is not a trace ID is worse than none, because
 * queries silently return nothing.
 */
@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  constructor(private readonly requestContext: RequestContextService) {}

  intercept<T>(context: ExecutionContext, next: CallHandler<T>): Observable<T> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithId>();
    const traceparent = request.header('traceparent');
    const match =
      traceparent === undefined ? null : TRACEPARENT.exec(traceparent);

    // `requestId` is deliberately absent: `pino-http`'s `customProps` already
    // binds it to the request's child logger, and assigning it again here
    // would put the key on every line twice.
    if (match) {
      this.requestContext.setCorrelation({
        traceId: match[1],
        spanId: match[2],
      });
    }

    return next.handle();
  }
}
