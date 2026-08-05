import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { catchError, concatMap, from, of, throwError, type Observable } from 'rxjs';

import { AppException } from '../api/app-exception';
import { attachIdempotencyMeta } from '../api/idempotency-meta';
import type { RequestWithId } from '../types/request-with-id';
import type { TenantContext } from '../types/tenant-context';
import { IdempotencyContextResolver } from './idempotency-context.resolver';
import {
  IDEMPOTENCY_KEY_HEADER,
  IDEMPOTENCY_KEY_PATTERN,
  IN_FLIGHT_RETRY_AFTER_SECONDS,
} from './idempotency.constants';
import {
  IDEMPOTENT_KEY,
  type IdempotencySettings,
} from './idempotency.decorator';
import {
  IdempotencyService,
  type IdempotencyDecision,
} from './idempotency.service';
import { requestFingerprint } from './request-fingerprint';
import { routeTemplateOf } from './route-template';
import type { StoredResponse } from './stored-response';

const SERVER_ERROR_FLOOR = 500;
const DEFAULT_SUCCESS_STATUS = 200;

/**
 * The mechanism, wired to a route by `@Idempotent()` —
 * IDEMPOTENCY_AND_CONCURRENCY.md §12.
 *
 * ## Where it sits
 *
 * After authentication, before the handler. Not negotiable: the scope is
 * `(organizationId, actorId, method, route, key)` and the first two do not
 * exist until a caller has been resolved.
 *
 * ## What it does not do yet, stated plainly
 *
 * §11 puts the reservation, the business write and the `COMPLETED` mark in
 * **one transaction**. This settles the record after the handler has already
 * committed, so a crash in the gap leaves a `PENDING` row — which the lock
 * takeover then re-executes. That is survivable and it is not what §11 asks
 * for. Closing it needs the handler to run inside a transaction the
 * interceptor opened, and this codebase has no ambient transactional context
 * to carry one; building that for a mechanism with no consumer would be
 * guessing at the shape the first real write wants. It arrives with that
 * write, in sprint 12.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly contexts: IdempotencyContextResolver,
    private readonly idempotency: IdempotencyService,
  ) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const settings = this.reflector.getAllAndOverride<
      IdempotencySettings | undefined
    >(IDEMPOTENT_KEY, [context.getHandler(), context.getClass()]);

    if (settings === undefined) {
      return next.handle();
    }

    return from(this.begin(context, settings)).pipe(
      concatMap((started) => this.act(started, context, next)),
    );
  }

  private async begin(
    context: ExecutionContext,
    settings: IdempotencySettings,
  ): Promise<{
    readonly tenant: TenantContext;
    readonly decision: IdempotencyDecision;
  }> {
    const request = context.switchToHttp().getRequest<RequestWithId>();
    const key = readKey(request);
    const tenant = await this.contexts.resolve(request);

    if (tenant === null) {
      // Authenticated, but on a platform session. The tenant-scoped mechanism
      // has nothing to scope to; see `IdempotencyRepository` for why the
      // platform path is deliberately absent rather than approximated.
      throw new AppException('AUTH_TENANT_DENIED', {
        detail: 'An idempotent route requires an active organization context',
      });
    }

    const route = routeTemplateOf(request);
    const decision = await this.idempotency.begin(tenant, {
      scope: {
        actorId: tenant.userId,
        method: request.method,
        route,
        key,
      },
      requestHash: requestFingerprint({
        method: request.method,
        routeTemplate: route,
        organizationId: tenant.organizationId,
        actorId: tenant.userId,
        body: request.body,
        pathParams: request.params,
      }),
      actorSessionId: tenant.sessionId,
      retention: settings.retention,
      now: new Date(),
    });

    return { tenant, decision };
  }

  private act(
    started: {
      readonly tenant: TenantContext;
      readonly decision: IdempotencyDecision;
    },
    context: ExecutionContext,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<RequestWithId>();
    const response = http.getResponse<Response>();

    switch (started.decision.kind) {
      case 'CONFLICT':
        return throwError(
          () =>
            new AppException('IDEMPOTENCY_CONFLICT', {
              detail:
                'This idempotency key was already used for a different request',
            }),
        );

      case 'IN_FLIGHT':
        // ADR-0012's decision, and the only place it is visible: the wait
        // happens on the client, which costs nothing, instead of on a held
        // server connection, which under offline sync costs the pool.
        response.setHeader('Retry-After', String(IN_FLIGHT_RETRY_AFTER_SECONDS));

        return throwError(
          () =>
            new AppException('IDEMPOTENCY_CONFLICT', {
              detail: 'A request with this idempotency key is still in flight',
              retryable: true,
              extensions: {
                retryAfter: String(IN_FLIGHT_RETRY_AFTER_SECONDS),
              },
            }),
        );

      case 'REPLAY':
        return this.replay(started.decision, request, response);

      case 'EXECUTE':
        return this.execute(
          started.decision.recordId,
          started.tenant,
          request,
          response,
          next,
        );
    }
  }

  private replay(
    decision: Extract<IdempotencyDecision, { kind: 'REPLAY' }>,
    request: RequestWithId,
    response: Response,
  ): Observable<unknown> {
    attachIdempotencyMeta(request, {
      replayed: true,
      originalRequestId: decision.response.requestId,
    });

    if (decision.response.kind === 'FAILURE') {
      const stored = decision.response;

      return throwError(
        () =>
          new AppException(stored.code, {
            detail: stored.detail,
            errors: stored.errors,
            retryable: stored.retryable,
            extensions: stored.extensions,
          }),
      );
    }

    // The stored status, not a fresh one: a replayed `201` is still the `201`
    // the resource was created with, and answering `200` would tell a client
    // that had missed the first response that nothing was created.
    response.status(decision.status);

    return of(decision.response.data);
  }

  private execute(
    recordId: string,
    tenant: TenantContext,
    request: RequestWithId,
    response: Response,
    next: CallHandler<unknown>,
  ): Observable<unknown> {
    return next.handle().pipe(
      concatMap(async (data) => {
        const stored: StoredResponse = {
          kind: 'SUCCESS',
          requestId: request.id,
          data: data ?? null,
        };

        await this.idempotency.complete(tenant, {
          recordId,
          responseStatus: response.statusCode || DEFAULT_SUCCESS_STATUS,
          response: stored,
        });

        return data;
      }),
      catchError((error: unknown) =>
        from(this.settleFailure(recordId, tenant, request, error)).pipe(
          concatMap(() => throwError(() => error)),
        ),
      ),
    );
  }

  /**
   * §5's split, and the reason it is not one state.
   *
   * A definitive `4xx` is memorised: re-running it would reach the same
   * refusal and spend a round trip proving it. A `5xx` or anything unrecognised
   * is not memorised at all — it says nothing about the request, only about the
   * moment, and storing it would turn a database blip into a permanent answer.
   */
  private async settleFailure(
    recordId: string,
    tenant: TenantContext,
    request: RequestWithId,
    error: unknown,
  ): Promise<void> {
    const status =
      error instanceof AppException ? error.getStatus() : SERVER_ERROR_FLOOR;

    if (
      !(error instanceof AppException) ||
      status >= SERVER_ERROR_FLOOR ||
      error.retryable
    ) {
      await this.idempotency.failRetryable(tenant, {
        recordId,
        responseStatus: status,
      });

      return;
    }

    await this.idempotency.failFinal(tenant, {
      recordId,
      responseStatus: status,
      response: {
        kind: 'FAILURE',
        requestId: request.id,
        code: error.code,
        detail: error.detail,
        errors: error.errors,
        retryable: error.retryable,
        extensions: error.extensions,
      },
    });
  }
}

/**
 * There is no "missing key means no idempotency" branch. On a route carrying
 * the decorator, a request without a key is the one that will produce the
 * duplicate, so it is refused before anything else happens.
 */
function readKey(request: RequestWithId): string {
  const header = request.headers[IDEMPOTENCY_KEY_HEADER];
  const value = Array.isArray(header) ? header[0] : header;

  if (value === undefined || value.length === 0) {
    throw new AppException('VALIDATION_ERROR', {
      detail: 'This operation requires an Idempotency-Key header',
      errors: [
        {
          field: 'Idempotency-Key',
          code: 'REQUIRED',
          message: 'This operation requires an Idempotency-Key header',
        },
      ],
    });
  }

  if (!IDEMPOTENCY_KEY_PATTERN.test(value)) {
    throw new AppException('VALIDATION_ERROR', {
      detail: 'Idempotency-Key must be 16 to 128 characters of [A-Za-z0-9_-]',
      errors: [
        {
          field: 'Idempotency-Key',
          code: 'INVALID_FORMAT',
          message:
            'Idempotency-Key must be 16 to 128 characters of [A-Za-z0-9_-]',
        },
      ],
    });
  }

  return value;
}
