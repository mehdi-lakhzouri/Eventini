import type { IncomingMessage, ServerResponse } from 'node:http';

import { buildHttpLoggingOptions } from './http-logging.config';
import type { LoggingSettings } from './logging.config';

function settings(overrides: Partial<LoggingSettings> = {}): LoggingSettings {
  return {
    level: 'info',
    format: 'json',
    pretty: false,
    serviceName: 'eventini-api',
    serviceVersion: '1.2.3',
    redactionEnabled: true,
    httpEnabled: true,
    httpSuccessEnabled: true,
    slowRequestThresholdMs: 1000,
    slowQueryThresholdMs: 500,
    debugModules: undefined,
    debugExpiresAt: undefined,
    environment: 'production',
    instanceId: 'api-1',
    ...overrides,
  };
}

const request = (url: string): IncomingMessage =>
  ({ url, headers: {}, id: 'req_test' }) as IncomingMessage;
const response = (statusCode: number): ServerResponse =>
  ({ statusCode }) as ServerResponse;

describe('buildHttpLoggingOptions', () => {
  it('renames pino-http reqId to the §9.2 field name', () => {
    expect(buildHttpLoggingOptions(settings()).customAttributeKeys).toEqual({
      reqId: 'requestId',
    });
  });

  // Bound to the child logger, so it lands on every line of the request —
  // not only the access line.
  it('binds the request ID via customProps', () => {
    expect(
      buildHttpLoggingOptions(settings()).customProps?.(
        request('/api/v1/x'),
        response(200),
      ),
    ).toEqual({ requestId: 'req_test' });
  });

  /**
   * customProps is applied twice by pino-http and de-duplicated only when the
   * serialised bindings are byte-identical. Anything status-dependent in
   * there would therefore be emitted twice — once with the request-start
   * guess. This pins the invariant that keeps that from regressing.
   */
  it('keeps customProps stable between request start and response end', () => {
    const options = buildHttpLoggingOptions(settings());
    const atStart = options.customProps?.(request('/api/v1/x'), response(200));
    const atEnd = options.customProps?.(request('/api/v1/x'), response(500));

    expect(atStart).toEqual(atEnd);
  });

  // §19's level policy table, asserted row by row.
  describe('customLogLevel', () => {
    const level = (status: number, error?: Error, custom = settings()) =>
      buildHttpLoggingOptions(custom).customLogLevel?.(
        request('/api/v1/x'),
        response(status),
        error,
      );

    it.each([
      [200, 'info'],
      [201, 'info'],
      [400, 'info'],
      [401, 'info'],
      [403, 'info'],
      [404, 'info'],
      [409, 'info'],
      [422, 'info'],
      [429, 'warn'],
      [500, 'error'],
      [503, 'error'],
    ])('logs %i at %s', (status, expected) => {
      expect(level(status)).toBe(expected);
    });

    it('logs at error when pino-http reports a handler error', () => {
      expect(level(200, new Error('boom'))).toBe('error');
    });

    it('silences successful requests when LOG_HTTP_SUCCESS_ENABLED is false', () => {
      expect(
        level(200, undefined, settings({ httpSuccessEnabled: false })),
      ).toBe('silent');
      // Failures are never silenced by that switch.
      expect(
        level(500, undefined, settings({ httpSuccessEnabled: false })),
      ).toBe('error');
    });
  });

  describe('final access-log object', () => {
    const accessObject = (status: number): unknown =>
      buildHttpLoggingOptions(settings()).customSuccessObject?.(
        request('/api/v1/x'),
        response(status),
        {},
      );

    it('tags every access line with the HTTP_ACCESS category', () => {
      expect(accessObject(200)).toMatchObject({ category: 'HTTP_ACCESS' });
    });

    it('distinguishes completed from failed by event code', () => {
      expect(accessObject(200)).toMatchObject({
        eventCode: 'HTTP_REQUEST_COMPLETED',
      });
      expect(accessObject(500)).toMatchObject({
        eventCode: 'HTTP_REQUEST_FAILED',
      });
    });
  });

  describe('autoLogging.ignore', () => {
    const ignores = (url: string): boolean => {
      const autoLogging = buildHttpLoggingOptions(settings()).autoLogging;
      if (typeof autoLogging !== 'object') {
        throw new Error('autoLogging should be configured as an object');
      }
      return autoLogging.ignore?.(request(url)) ?? false;
    };

    it.each(['/health/live', '/health/ready', '/metrics'])(
      'ignores %s, which the orchestrator polls constantly',
      (url) => {
        expect(ignores(url)).toBe(true);
      },
    );

    it('ignores them behind the global prefix too', () => {
      expect(ignores('/api/v1/health/live')).toBe(true);
    });

    it('still ignores them when a query string is present', () => {
      expect(ignores('/metrics?format=prometheus')).toBe(true);
    });

    it('does not ignore real traffic', () => {
      expect(ignores('/api/v1/events')).toBe(false);
    });
  });
});
