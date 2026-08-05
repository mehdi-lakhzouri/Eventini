import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { firstValueFrom, of, throwError } from 'rxjs';

import { AppException } from '../api/app-exception';
import { idempotencyMetaOf } from '../api/idempotency-meta';
import type { TenantContext } from '../types/tenant-context';
import { IdempotencyContextResolver } from './idempotency-context.resolver';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import type { IdempotencySettings } from './idempotency.decorator';
import {
  IdempotencyService,
  type BeginInput,
  type IdempotencyDecision,
} from './idempotency.service';
import type { StoredResponse } from './stored-response';

const KEY = 'A'.repeat(26);

const tenant: TenantContext = {
  organizationId: 'org_01',
  membershipId: 'mbr_01',
  userId: 'usr_01',
  sessionId: 'ses_01',
  authLevel: 'PASSWORD',
};

interface Harness {
  readonly context: ExecutionContext;
  readonly request: Record<string, unknown>;
  readonly headers: Record<string, string>;
  readonly setHeaders: Record<string, string>;
  statusCode: number;
}

function makeHarness(headers: Record<string, string>): Harness {
  const setHeaders: Record<string, string> = {};
  const request: Record<string, unknown> = {
    id: 'req_current',
    method: 'POST',
    headers,
    body: { a: 1 },
    params: {},
    route: { path: '/api/v1/probes' },
    originalUrl: '/api/v1/probes',
    url: '/api/v1/probes',
  };
  const harness: Harness = {
    request,
    headers,
    setHeaders,
    statusCode: 201,
    context: {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          get statusCode() {
            return harness.statusCode;
          },
          setHeader: (name: string, value: string) => {
            setHeaders[name] = value;
          },
          status: (code: number) => {
            harness.statusCode = code;
          },
        }),
      }),
      getHandler: () => function handler() {},
      getClass: () => class Controller {},
    } as unknown as ExecutionContext,
  };

  return harness;
}

function makeReflector(settings: IdempotencySettings | undefined): Reflector {
  return {
    getAllAndOverride: () => settings,
  } as unknown as Reflector;
}

function makeResolver(
  context: TenantContext | null,
): IdempotencyContextResolver {
  return {
    resolve: () => Promise.resolve(context),
  };
}

class RecordingService {
  readonly begins: BeginInput[] = [];
  readonly completions: { recordId: string; responseStatus: number }[] = [];
  readonly finals: { recordId: string; response: StoredResponse }[] = [];
  readonly retryables: { recordId: string; responseStatus: number }[] = [];

  constructor(private readonly decision: IdempotencyDecision) {}

  // Synchronous recorders behind an async port; no await is needed to honour
  // a contract shaped for a database.
  begin(
    _context: TenantContext,
    input: BeginInput,
  ): Promise<IdempotencyDecision> {
    this.begins.push(input);

    return Promise.resolve(this.decision);
  }

  complete(
    _context: TenantContext,
    input: { recordId: string; responseStatus: number },
  ): Promise<void> {
    this.completions.push(input);

    return Promise.resolve();
  }

  failFinal(
    _context: TenantContext,
    input: { recordId: string; response: StoredResponse },
  ): Promise<void> {
    this.finals.push(input);

    return Promise.resolve();
  }

  failRetryable(
    _context: TenantContext,
    input: { recordId: string; responseStatus: number },
  ): Promise<void> {
    this.retryables.push(input);

    return Promise.resolve();
  }
}

function build(
  decision: IdempotencyDecision,
  options: {
    readonly undecorated?: boolean;
    readonly context?: TenantContext | null;
    readonly headers?: Record<string, string>;
  } = {},
) {
  const service = new RecordingService(decision);
  const harness = makeHarness(options.headers ?? { 'idempotency-key': KEY });
  const settings: IdempotencySettings | undefined =
    options.undecorated === true ? undefined : { retention: '24h' };
  const interceptor = new IdempotencyInterceptor(
    makeReflector(settings),
    makeResolver(options.context === undefined ? tenant : options.context),
    service as unknown as IdempotencyService,
  );

  return { interceptor, service, harness };
}

function handlerOf(value: unknown): CallHandler<unknown> {
  return { handle: () => of(value) };
}

function failingHandler(error: unknown): CallHandler<unknown> {
  return { handle: () => throwError(() => error) };
}

async function codeOf(work: Promise<unknown>): Promise<string> {
  return work.then(
    () => 'NO_ERROR',
    (error: unknown) =>
      error instanceof AppException ? error.code : String(error),
  );
}

describe('IdempotencyInterceptor', () => {
  it('leaves an undecorated route alone', async () => {
    const { interceptor, service, harness } = build(
      { kind: 'EXECUTE', recordId: 'idm_01' },
      { undecorated: true },
    );

    await expect(
      firstValueFrom(
        interceptor.intercept(harness.context, handlerOf({ ok: true })),
      ),
    ).resolves.toEqual({ ok: true });
    expect(service.begins).toHaveLength(0);
  });

  describe('the key', () => {
    it.each([
      ['absent', {}],
      ['too short', { 'idempotency-key': 'short' }],
      [
        'carrying a character outside the class',
        { 'idempotency-key': `${KEY}!` },
      ],
    ])('rejects a key that is %s', async (_label, headers) => {
      const { interceptor, harness } = build(
        { kind: 'EXECUTE', recordId: 'idm_01' },
        { headers },
      );

      await expect(
        codeOf(
          firstValueFrom(
            interceptor.intercept(harness.context, handlerOf({ ok: true })),
          ),
        ),
      ).resolves.toBe('VALIDATION_ERROR');
    });
  });

  /**
   * The scope needs an organization, and a platform session has none — see
   * `IdempotencyRepository` for why that path is absent rather than guessed at.
   */
  it('refuses a caller with no organization', async () => {
    const { interceptor, harness } = build(
      { kind: 'EXECUTE', recordId: 'idm_01' },
      { context: null },
    );

    await expect(
      codeOf(
        firstValueFrom(
          interceptor.intercept(harness.context, handlerOf({ ok: true })),
        ),
      ),
    ).resolves.toBe('AUTH_TENANT_DENIED');
  });

  it('hashes the route template rather than the concrete URI', async () => {
    const { interceptor, service, harness } = build({
      kind: 'EXECUTE',
      recordId: 'idm_01',
    });

    await firstValueFrom(
      interceptor.intercept(harness.context, handlerOf({ ok: true })),
    );

    expect(service.begins[0]?.scope.route).toBe('/api/v1/probes');
  });

  describe('a won claim', () => {
    it('runs the handler and memorises the response', async () => {
      const { interceptor, service, harness } = build({
        kind: 'EXECUTE',
        recordId: 'idm_01',
      });

      await expect(
        firstValueFrom(
          interceptor.intercept(harness.context, handlerOf({ id: 'att_01' })),
        ),
      ).resolves.toEqual({ id: 'att_01' });
      expect(service.completions).toHaveLength(1);
      expect(service.completions[0]).toMatchObject({
        recordId: 'idm_01',
        responseStatus: 201,
      });
      // Asserted separately: `expect.anything()` is typed `any`, and inlining
      // it into the array literal widens the whole comparison.
      expect(service.completions[0]).toHaveProperty('response');
    });

    it('memorises a definitive refusal', async () => {
      const { interceptor, service, harness } = build({
        kind: 'EXECUTE',
        recordId: 'idm_01',
      });

      await codeOf(
        firstValueFrom(
          interceptor.intercept(
            harness.context,
            failingHandler(new AppException('EVENT_NOT_ACTIVE')),
          ),
        ),
      );

      expect(service.finals[0]?.response).toMatchObject({
        kind: 'FAILURE',
        code: 'EVENT_NOT_ACTIVE',
      });
    });

    /**
     * A 503 says something about the moment, not about the request. Memorising
     * it would turn a database blip into a permanent answer for that key.
     */
    it.each([
      ['a server error', new AppException('DEPENDENCY_UNAVAILABLE')],
      ['an unknown throw', new Error('boom')],
    ])('does not memorise %s', async (_label, error) => {
      const { interceptor, service, harness } = build({
        kind: 'EXECUTE',
        recordId: 'idm_01',
      });

      await codeOf(
        firstValueFrom(
          interceptor.intercept(harness.context, failingHandler(error)),
        ),
      );

      expect(service.finals).toHaveLength(0);
      expect(service.retryables).toHaveLength(1);
    });

    it('rethrows the original error after recording it', async () => {
      const { interceptor, harness } = build({
        kind: 'EXECUTE',
        recordId: 'idm_01',
      });

      await expect(
        codeOf(
          firstValueFrom(
            interceptor.intercept(
              harness.context,
              failingHandler(new AppException('EVENT_NOT_ACTIVE')),
            ),
          ),
        ),
      ).resolves.toBe('EVENT_NOT_ACTIVE');
    });
  });

  describe('a taken key', () => {
    it('answers 409 for a different request', async () => {
      const { interceptor, harness } = build({ kind: 'CONFLICT' });

      await expect(
        codeOf(
          firstValueFrom(
            interceptor.intercept(harness.context, handlerOf({ ok: true })),
          ),
        ),
      ).resolves.toBe('IDEMPOTENCY_CONFLICT');
    });

    /** ADR-0012: the wait belongs on the client, where it is free. */
    it('answers 409 with Retry-After while in flight', async () => {
      const { interceptor, harness } = build({ kind: 'IN_FLIGHT' });

      await expect(
        codeOf(
          firstValueFrom(
            interceptor.intercept(harness.context, handlerOf({ ok: true })),
          ),
        ),
      ).resolves.toBe('IDEMPOTENCY_CONFLICT');
      expect(harness.setHeaders['Retry-After']).toBe('2');
    });

    it('never calls the handler for an in-flight key', async () => {
      const { interceptor, harness } = build({ kind: 'IN_FLIGHT' });
      const handle = jest.fn(() => of({ ok: true }));

      await codeOf(
        firstValueFrom(
          interceptor.intercept(harness.context, {
            handle,
          }),
        ),
      );

      expect(handle).not.toHaveBeenCalled();
    });
  });

  describe('a replay', () => {
    const stored: StoredResponse = {
      kind: 'SUCCESS',
      requestId: 'req_original',
      data: { id: 'att_01' },
    };

    it('returns the memorised body without running the handler', async () => {
      const { interceptor, harness } = build({
        kind: 'REPLAY',
        response: stored,
        status: 201,
      });
      const handle = jest.fn(() => of({ id: 'att_other' }));

      await expect(
        firstValueFrom(
          interceptor.intercept(harness.context, {
            handle,
          }),
        ),
      ).resolves.toEqual({ id: 'att_01' });
      expect(handle).not.toHaveBeenCalled();
    });

    /** Answering 200 would tell a client that missed the 201 nothing was created. */
    it('restores the original status', async () => {
      const { interceptor, harness } = build({
        kind: 'REPLAY',
        response: stored,
        status: 201,
      });
      harness.statusCode = 200;

      await firstValueFrom(
        interceptor.intercept(harness.context, handlerOf(null)),
      );

      expect(harness.statusCode).toBe(201);
    });

    it('marks the response so meta can carry the original request id', async () => {
      const { interceptor, harness } = build({
        kind: 'REPLAY',
        response: stored,
        status: 200,
      });

      await firstValueFrom(
        interceptor.intercept(harness.context, handlerOf(null)),
      );

      expect(idempotencyMetaOf(harness.request)).toEqual({
        replayed: true,
        originalRequestId: 'req_original',
      });
    });

    it('rethrows a memorised refusal, still marked as a replay', async () => {
      const { interceptor, harness } = build({
        kind: 'REPLAY',
        response: {
          kind: 'FAILURE',
          requestId: 'req_original',
          code: 'EVENT_NOT_ACTIVE',
          detail: 'Event not active',
          errors: [],
          retryable: false,
          extensions: {},
        },
        status: 409,
      });

      await expect(
        codeOf(
          firstValueFrom(
            interceptor.intercept(harness.context, handlerOf(null)),
          ),
        ),
      ).resolves.toBe('EVENT_NOT_ACTIVE');
      expect(idempotencyMetaOf(harness.request)).toMatchObject({
        replayed: true,
      });
    });
  });
});
