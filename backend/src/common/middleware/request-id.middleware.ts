import { randomUUID } from 'node:crypto';

import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';

import type { RequestWithId } from '../types/request-with-id';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * Printable ASCII, no whitespace, bounded length — a client-supplied
 * request ID becomes an HTTP response header and a log field verbatim, so
 * anything permissive enough to allow CR/LF or an unbounded string is a
 * header/log-injection surface, not a courtesy to the caller.
 */
const VALID_REQUEST_ID = /^[A-Za-z0-9_-]{8,128}$/;

function generateRequestId(): string {
  return `req_${randomUUID()}`;
}

/**
 * Resolves the request's ID once and memoises it on the request.
 *
 * Idempotent on purpose. Two independent pieces of middleware need this ID —
 * this one, and `pino-http`'s `genReqId` (EVT-011) — and Nest gives no
 * guarantee about which of an imported module's middleware and the host
 * module's own runs first. Rather than depend on an order that could change
 * with an import reshuffle, both call this: whichever arrives first computes
 * the ID, the other finds it already present. They cannot disagree, so the
 * ID in the logs is always the ID in `meta.requestId` and in the response
 * header.
 */
export function ensureRequestId(request: RequestWithId): string {
  if (typeof request.id === 'string' && request.id.length > 0) {
    return request.id;
  }

  const supplied = request.headers[REQUEST_ID_HEADER.toLowerCase()];
  const candidate = typeof supplied === 'string' ? supplied : undefined;

  const id =
    candidate !== undefined && VALID_REQUEST_ID.test(candidate)
      ? candidate
      : generateRequestId();

  request.id = id;
  return id;
}

/**
 * Stamps every request with an ID before anything else runs, so it is
 * available to the logger (EVT-011), the response envelope, and the
 * exception filter alike. A valid client-supplied ID is kept — it lets a
 * caller correlate its own logs with ours; anything else is replaced. The
 * header is always present on the response, generated or not.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    response.setHeader(REQUEST_ID_HEADER, ensureRequestId(request));
    next();
  }
}
