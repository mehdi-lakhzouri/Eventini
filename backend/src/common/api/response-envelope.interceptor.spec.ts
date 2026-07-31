import {
  HttpStatus,
  type CallHandler,
  type ExecutionContext,
} from '@nestjs/common';
import { of, firstValueFrom } from 'rxjs';

import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

function makeContext(statusCode: number): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ id: 'req_test123' }),
      getResponse: () => ({ statusCode }),
    }),
  } as unknown as ExecutionContext;
}

function makeHandler<T>(value: T): CallHandler<T> {
  return { handle: () => of(value) };
}

describe('ResponseEnvelopeInterceptor', () => {
  const interceptor = new ResponseEnvelopeInterceptor();

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

    expect(result?.data).toBeNull();
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
});
