import { NotFoundException, type ArgumentsHost } from '@nestjs/common';
import type { PinoLogger } from 'nestjs-pino';

import { AppException } from './app-exception';
import { HttpExceptionFilter } from './http-exception.filter';

function makeLogger(): {
  pino: PinoLogger;
  error: jest.Mock;
  warn: jest.Mock;
  setContext: jest.Mock;
} {
  const error = jest.fn();
  const warn = jest.fn();
  const setContext = jest.fn();

  return {
    pino: { error, warn, setContext } as unknown as PinoLogger,
    error,
    warn,
    setContext,
  };
}

function makeHost(request: {
  method: string;
  originalUrl: string;
  id: string;
}): {
  host: ArgumentsHost;
  response: { status: jest.Mock; contentType: jest.Mock; json: jest.Mock };
} {
  const response = {
    status: jest.fn().mockReturnThis(),
    contentType: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response };
}

describe('HttpExceptionFilter', () => {
  let logger: ReturnType<typeof makeLogger>;
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    logger = makeLogger();
    filter = new HttpExceptionFilter(logger.pino);
  });

  it('renders an AppException as RFC 9457 problem+json with its own code', () => {
    const { host, response } = makeHost({
      method: 'GET',
      originalUrl: '/api/v1/events/evt_1',
      id: 'req_1',
    });

    filter.catch(new AppException('AUTH_TENANT_DENIED'), host);

    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.contentType).toHaveBeenCalledWith(
      'application/problem+json',
    );
    const [envelope] = response.json.mock.calls[0] as [
      {
        data: null;
        error: { code: string; status: number };
        meta: { requestId: string };
      },
    ];
    expect(envelope.data).toBeNull();
    expect(envelope.error.code).toBe('AUTH_TENANT_DENIED');
    expect(envelope.error.status).toBe(403);
    expect(envelope.meta.requestId).toBe('req_1');
  });

  it('maps a bare Nest HttpException through the default-status table', () => {
    const { host, response } = makeHost({
      method: 'GET',
      originalUrl: '/api/v1/unknown',
      id: 'req_2',
    });

    filter.catch(new NotFoundException(), host);

    const [envelope] = response.json.mock.calls[0] as [
      { error: { code: string } },
    ];
    expect(envelope.error.code).toBe('RESOURCE_NOT_FOUND');
  });

  it('never leaks the message of an unknown thrown error into the response', () => {
    const { host, response } = makeHost({
      method: 'GET',
      originalUrl: '/api/v1/x',
      id: 'req_3',
    });

    filter.catch(new Error('relation "users" does not exist'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    const [envelope] = response.json.mock.calls[0] as [
      { error: { detail: string } },
    ];
    expect(envelope.error.detail).toBe('An unexpected error occurred.');
  });

  // PINO_LOGGING_SPECIFICATION.md §39.4 — the stack must reach the log and
  // must not reach the response. Both halves asserted, on the same exception.
  it('passes the error to the logger for a 5xx while keeping it out of the response', () => {
    const { host, response } = makeHost({
      method: 'GET',
      originalUrl: '/api/v1/x',
      id: 'req_4',
    });
    const thrown = new Error('relation "users" does not exist');

    filter.catch(thrown, host);

    expect(logger.error).toHaveBeenCalledTimes(1);
    const [fields] = logger.error.mock.calls[0] as [
      { err: unknown; eventCode: string; errorCode: string; operation: string },
    ];
    expect(fields.err).toBe(thrown);
    expect(fields.eventCode).toBe('UNHANDLED_APPLICATION_ERROR');
    expect(fields.errorCode).toBe('INTERNAL_ERROR');
    // `requestId` is intentionally absent — pino-http's customProps already
    // binds it to the request's child logger, so the filter adding it would
    // emit the key twice on the same line.
    expect(fields).not.toHaveProperty('requestId');
    expect(fields.operation).toBe('GET /api/v1/x');

    expect(JSON.stringify(response.json.mock.calls[0])).not.toContain(
      'does not exist',
    );
  });

  // §3.4 "Une erreur, un log" — exactly one line per exception, never one
  // per layer, or every error count downstream is inflated.
  it('logs exactly once per exception, at warn for 4xx and error for 5xx', () => {
    const { host } = makeHost({
      method: 'GET',
      originalUrl: '/api/v1/x',
      id: 'req_5',
    });

    filter.catch(new AppException('AUTH_TENANT_DENIED'), host);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
