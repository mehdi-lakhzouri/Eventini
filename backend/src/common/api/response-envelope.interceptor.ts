import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

import { buildResponseMeta } from './build-response-meta';
import type { ApiEnvelope } from './problem-details.types';
import type { RequestWithId } from '../types/request-with-id';

/**
 * Wraps every success response in `{ data, meta, error: null }` — the
 * `data`/`meta`/`error` triad ADR-0008 requires on *every* response, not
 * only errors.
 *
 * A `204` is left untouched: the HTTP spec forbids a body on that status,
 * and API_CONVENTIONS.md §3 makes `204` the default for an action with no
 * representation. Wrapping it would mean sending a body Express then has to
 * silently drop, or breaking the contract this ticket exists to establish.
 */
const NO_CONTENT_STATUS = 204;

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ApiEnvelope<T> | undefined
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiEnvelope<T> | undefined> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    return next.handle().pipe(
      map((data) => {
        if (response.statusCode === NO_CONTENT_STATUS) {
          return undefined;
        }

        return {
          data: data ?? null,
          meta: buildResponseMeta(request.id),
          error: null,
        };
      }),
    );
  }
}
