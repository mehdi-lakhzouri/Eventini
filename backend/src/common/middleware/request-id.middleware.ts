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
 * Stamps every request with an ID before anything else runs, so it is
 * available to the logger (EVT-011), the response envelope, and the
 * exception filter alike. A valid client-supplied ID is kept — it lets a
 * caller correlate its own logs with ours; anything else is replaced. The
 * header is always present on the response, generated or not.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const supplied = request.header(REQUEST_ID_HEADER);
    const id =
      supplied && VALID_REQUEST_ID.test(supplied)
        ? supplied
        : generateRequestId();

    request.id = id;
    response.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}
