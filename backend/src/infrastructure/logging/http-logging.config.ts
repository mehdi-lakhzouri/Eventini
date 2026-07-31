import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Options } from 'pino-http';

import { ensureRequestId } from '../../common/middleware';
import type { RequestWithId } from '../../common/types';
import { buildPinoOptions, type LoggingSettings } from './logging.config';
import {
  HTTP_STATUS_CLIENT_ERROR,
  HTTP_STATUS_SERVER_ERROR,
  HTTP_STATUS_TOO_MANY_REQUESTS,
  UNLOGGED_ROUTES,
} from './logging.constants';

interface RequestWithOriginalUrl extends IncomingMessage {
  originalUrl?: string;
}

function requestIdOf(request: IncomingMessage): string | undefined {
  const { id } = request as { id?: unknown };
  return typeof id === 'string' ? id : undefined;
}

/**
 * `pino-http` options — PINO_LOGGING_SPECIFICATION.md §19.
 *
 * One line per request, at the end. No request body and no response body are
 * ever logged: §19 is explicit that only a deliberately-constructed summary
 * may be logged, never `req.body`/`res.body` automatically. That is enforced
 * by the serializers in `log-serializers.ts`, which allowlist their fields.
 */
export function buildHttpLoggingOptions(settings: LoggingSettings): Options {
  return {
    ...buildPinoOptions(settings),

    /**
     * Shares one ID with `RequestIdMiddleware` instead of minting a second.
     * §11 requires a single identifier across the HTTP log, the application
     * logs, the API response's `meta.requestId` and any job spawned from the
     * request; two generators would produce a correlation field that silently
     * fails to correlate. `ensureRequestId` is idempotent, so this holds
     * regardless of which middleware Nest happens to run first.
     */
    genReqId: (request: IncomingMessage) =>
      ensureRequestId(request as unknown as RequestWithId),

    // The field is emitted as `requestId` (§9.2), not pino-http's `reqId`.
    customAttributeKeys: { reqId: 'requestId' },

    customLogLevel: (
      _request: IncomingMessage,
      response: ServerResponse,
      error?: Error,
    ) => {
      if (error || response.statusCode >= HTTP_STATUS_SERVER_ERROR) {
        return 'error';
      }
      if (response.statusCode === HTTP_STATUS_TOO_MANY_REQUESTS) {
        return 'warn';
      }
      // §19: expected 4xx (400/401/403/404/409/422) stay at `info`. They are
      // the API behaving correctly. A pattern of them is a security concern,
      // and that is raised by a dedicated security log, not by inflating the
      // level of every individual line.
      if (response.statusCode >= HTTP_STATUS_CLIENT_ERROR) {
        return 'info';
      }
      return settings.httpSuccessEnabled ? 'info' : 'silent';
    },

    /**
     * `requestId` — and *only* `requestId` — is bound onto the per-request
     * child logger, so every line emitted while handling the request carries
     * it: the access line, application logs, and the exception filter's line
     * even on an unmatched route where no interceptor ever runs.
     *
     * `customAttributeKeys.reqId` cannot do this: `pino-http` only promotes
     * the ID to a top-level field under `quietReqLogger`, which also discards
     * the whole `req` object (method, route) that §19's example line needs.
     *
     * Nothing else goes here. `pino-http` applies `customProps` twice — once
     * at request start and once at response end — and skips the second only
     * when the serialised bindings are byte-identical. A stable value like an
     * ID is therefore bound once; a status-dependent value is not, which is
     * why `category`/`eventCode` live in the response hooks below instead.
     */
    customProps: (request: IncomingMessage) => ({
      requestId: requestIdOf(request),
    }),

    /**
     * `category`/`eventCode` describe the *finished* request, so they are
     * attached to the final access-log object only.
     *
     * Putting them in `customProps` (the obvious first attempt) was wrong in
     * two ways at once, both observed in real output: every application log
     * in the request inherited `category: HTTP_ACCESS` and
     * `eventCode: HTTP_REQUEST_COMPLETED` — mislabelling business and
     * security lines as access logs, which matters because §8 makes
     * `category` the field dashboards slice on — and the access line itself
     * carried each key twice, with the start-of-request guess ahead of the
     * real value.
     */
    customSuccessObject: (
      _request: IncomingMessage,
      response: ServerResponse,
      object: object,
    ) => ({
      ...object,
      category: 'HTTP_ACCESS',
      eventCode:
        response.statusCode >= HTTP_STATUS_SERVER_ERROR
          ? 'HTTP_REQUEST_FAILED'
          : 'HTTP_REQUEST_COMPLETED',
    }),

    customErrorObject: (
      _request: IncomingMessage,
      _response: ServerResponse,
      _error: Error,
      object: object,
    ) => ({
      ...object,
      category: 'HTTP_ACCESS',
      eventCode: 'HTTP_REQUEST_FAILED',
    }),

    customSuccessMessage: () => 'HTTP request completed',
    customErrorMessage: () => 'HTTP request failed',

    autoLogging: {
      // §19 — health and metrics endpoints are polled every few seconds by the
      // orchestrator; logging them buries real traffic and costs money at rest.
      ignore: (request: IncomingMessage) => {
        const url =
          (request as RequestWithOriginalUrl).originalUrl ?? request.url ?? '';
        const path = url.split('?')[0] ?? '';
        return UNLOGGED_ROUTES.some((ignored) => path.endsWith(ignored));
      },
    },
  };
}
