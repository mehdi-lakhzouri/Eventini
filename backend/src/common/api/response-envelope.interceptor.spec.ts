import {
  HttpStatus,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { of, firstValueFrom } from 'rxjs';

import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

function makeContext(statusCode: number): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req_test123' }),
      getResponse: () => ({ statusCode }),
    }),
    // The interceptor asks the Reflector about the handler and its class, so
    // both have to exist on the context even though the stubbed Reflector
    // ignores what they are.
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
  } as unknown as ExecutionContext;
}

function makeHandler<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

/**
 * A `Reflector` that reports whether the handler carries `@RawResponse()`.
 * The real one reads decorator metadata; the interceptor only ever asks it
 * this one question, so a stub keeps these tests about enveloping.
 */
function makeReflector(isRaw = false): Reflector {
  return {
    getAllAndOverride: () => isRaw,
  } as unknown as Reflector;
}

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor(makeReflector());

  it('wraps a 200 response in data/meta/error', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(
        makeContext(HttpStatus.OK),
        makeHandler({ id: 'evt_1' }),
      ),
    );

    expect(result).toEqual({
      data: { id: 'evt_1' },
      meta: {
        requestId: 'req_test123',
        timestamp: expect.any(String) as string,
        apiVersion: 'v1',
      },
      error: null,
    });
  });

  it('defaults data to null when the handler returns undefined', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(makeContext(HttpStatus.OK), makeHandler(undefined)),
    );

    expect(result).toMatchObject({ data: null });
  });

  it('leaves a 204 response body untouched', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(
        makeContext(HttpStatus.NO_CONTENT),
        makeHandler(undefined),
      ),
    );

    expect(result).toBeUndefined();
  });

  /**
   * Prometheus rejects anything that is not its text exposition format, so
   * enveloping `/metrics` would switch monitoring off rather than degrade it.
   */
  it('returns the handler value untouched when @RawResponse() is present', async () => {
    const raw = new ResponseEnvelopeInterceptor(makeReflector(true));
    const body = '# HELP http_requests_total Requests.\n';

    const result = await firstValueFrom(
      raw.intercept(makeContext(HttpStatus.OK), makeHandler(body)),
    );

    expect(result).toBe(body);
  });

  it('still envelopes a handler without @RawResponse()', async () => {
    const result = await firstValueFrom(
      interceptor.intercept(makeContext(HttpStatus.OK), makeHandler('plain')),
    );

    expect(result).toMatchObject({ data: 'plain', error: null });
  });
});
