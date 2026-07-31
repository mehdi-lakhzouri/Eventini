import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';

import { buildResponseMeta } from './build-response-meta';
import type { ApiEnvelope } from './problem-details.types';
import { RAW_RESPONSE_KEY } from './raw-response.decorator';
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
 *
 * A handler marked `@RawResponse()` is left untouched too — see that
 * decorator for why `/metrics` cannot be enveloped.
 */
const NO_CONTENT_STATUS = 204;

@Injectable()
export class ResponseEnvelopeInterceptor<T> implements NestInterceptor<
  T,
  ApiEnvelope<T> | T | undefined
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiEnvelope<T> | T | undefined> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    return next.handle().pipe(
      map((data) => {
        if (isRaw) {
          return data;
        }

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
