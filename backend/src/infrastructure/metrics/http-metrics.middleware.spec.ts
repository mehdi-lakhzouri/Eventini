import type { NextFunction, Request, Response } from 'express';

import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsService } from './metrics.service';
import { UNMATCHED_ROUTE_LABEL } from './metrics.constants';

/**
 * A response stand-in that records the `finish` listener, so a test can end
 * the response exactly when it wants to. Recording on `finish` is what lets
 * the middleware read `req.route` after routing has run.
 */
function makeResponse(statusCode: number): Response & { finish: () => void } {
  let listener: (() => void) | undefined;

  const response = {
    statusCode,
    once: (event: string, cb: () => void) => {
      if (event === 'finish') {
        listener = cb;
      }
      return response;
    },
    finish: () => listener?.(),
  };

  return response as unknown as Response & { finish: () => void };
}

function makeRequest(method: string, routePath?: string): Request {
  return {
    method,
    ...(routePath === undefined ? {} : { route: { path: routePath } }),
  } as unknown as Request;
}

describe('HttpMetricsMiddleware', () => {
  let metrics: MetricsService;
  let middleware: HttpMetricsMiddleware;
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    metrics = new MetricsService('eventini-api', 'test');
    middleware = new HttpMetricsMiddleware(metrics);
  });

  it('always calls next, so metrics can never block a request', () => {
    const nextSpy = jest.fn();
    middleware.use(makeRequest('GET'), makeResponse(200), nextSpy);

    expect(nextSpy).toHaveBeenCalledTimes(1);
  });

  it('records nothing until the response finishes', async () => {
    middleware.use(makeRequest('GET', '/events'), makeResponse(200), next);

    expect(await metrics.render()).not.toContain('http_requests_total{route');
  });

  it('counts a completed request against its route template', async () => {
    const response = makeResponse(200);
    middleware.use(makeRequest('GET', '/events/:eventId'), response, next);
    response.finish();

    const rendered = await metrics.render();
    expect(rendered).toContain('route="/events/:eventId"');
    expect(rendered).toContain('method="GET"');
    expect(rendered).toContain('status="200"');
  });

  it('observes the duration histogram, not only the counter', async () => {
    const response = makeResponse(200);
    middleware.use(makeRequest('GET', '/events'), response, next);
    response.finish();

    expect(await metrics.render()).toContain(
      'http_request_duration_seconds_count',
    );
  });

  /**
   * The reason this is middleware rather than an interceptor: a global
   * interceptor never runs for a request that matched no route, so every 404
   * would be invisible — and a 404 spike is either a broken client or someone
   * enumerating the API.
   */
  it('counts a request that matched no route', async () => {
    const response = makeResponse(404);
    middleware.use(makeRequest('GET', undefined), response, next);
    response.finish();

    expect(await metrics.render()).toContain(
      `route="${UNMATCHED_ROUTE_LABEL}"`,
    );
  });

  it('records a 500 as readily as a 200', async () => {
    const response = makeResponse(500);
    middleware.use(makeRequest('POST', '/events'), response, next);
    response.finish();

    expect(await metrics.render()).toContain('status="500"');
  });
});
