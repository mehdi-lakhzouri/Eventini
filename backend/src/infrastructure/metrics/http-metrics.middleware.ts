import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { MetricsService } from './metrics.service';
import { UNMATCHED_ROUTE_LABEL } from './metrics.constants';

/**
 * Express types `route` as required, but it is genuinely absent until a route
 * matches — which is exactly the unmatched case this middleware exists to
 * cover — so it is re-declared as optional rather than extended.
 */
type RequestWithRoute = Omit<Request, 'route'> & {
  route?: { path?: string };
};

/**
 * Records `http_requests_total` and `http_request_duration_seconds`.
 *
 * ## Middleware, not an interceptor
 *
 * A global interceptor only runs once a route has matched, so every 404 to an
 * unmatched path is invisible to it — and a 404 spike is exactly the signal
 * worth having, being either a broken client or someone enumerating the API.
 * Middleware runs for every request, and recording on the response's `finish`
 * event means `req.route` has been populated by then for the requests that
 * did match. This is the same approach `pino-http` takes, for the same
 * reason.
 *
 * ## The route label is a template, never a path
 *
 * `/events/evt_01/sessions/ses_09` as a label value would create one time
 * series per event and session — the unbounded-cardinality failure §36 exists
 * to prevent, reached through the back door of a label whose *name* (`route`)
 * is on the allowlist. Express's matched route
 * (`/events/:eventId/sessions/:sessionId`) is bounded by the number of routes,
 * which is both safe and what a dashboard actually wants.
 *
 * A request that matched nothing has no template, so it is recorded under a
 * single `unmatched` bucket. Counting those is worth doing; recording their
 * paths would hand an attacker direct control over the series count.
 */
@Injectable()
export class HttpMetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(request: RequestWithRoute, response: Response, next: NextFunction): void {
    const startedAt = process.hrtime.bigint();

    response.once('finish', () => {
      const seconds =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;

      const labels = {
        route: request.route?.path ?? UNMATCHED_ROUTE_LABEL,
        method: request.method,
        status: String(response.statusCode),
      };

      const { httpRequestsTotal, httpRequestDurationSeconds } =
        this.metricsService.metrics;

      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, seconds);
    });

    next();
  }
}
