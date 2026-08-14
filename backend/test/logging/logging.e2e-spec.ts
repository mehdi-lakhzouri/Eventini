import { Controller, Get, Module, Query } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Logger, PARAMS_PROVIDER_TOKEN } from 'nestjs-pino';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildValidationPipe } from '../../src/bootstrap';
import { Public } from '../../src/common/decorators';
import {
  buildHttpLoggingOptions,
  type LoggingSettings,
} from '../../src/infrastructure/logging';

const CANARY = 'CANARY_SECRET_VALUE_9f3a';

/**
 * `@Public()`: this probe exists to exercise the validation pipe, the response
 * envelope and the logger. Sending it through the authorization chain would
 * make those tests depend on a session and prove something else — the chain
 * itself is covered by `guard-chain.e2e-spec.ts`.
 */
@Public()
@Controller('probe')
class ProbeController {
  @Get('ok')
  ok(): { id: string } {
    return { id: 'evt_1' };
  }

  @Get('boom')
  boom(): never {
    throw new Error(`internal detail ${CANARY}`);
  }

  @Get('search')
  search(@Query('token') _token: string): { ok: true } {
    return { ok: true };
  }
}

@Module({ imports: [AppModule], controllers: [ProbeController] })
class TestRootModule {}

/**
 * Collects the NDJSON the logger actually emits.
 *
 * Pino writes through `sonic-boom` straight to file descriptor 1, so
 * monkey-patching `process.stdout.write` captures nothing — the first version
 * of this suite did exactly that and silently asserted against an empty
 * array. The destination stream is therefore injected instead, by overriding
 * `nestjs-pino`'s params provider.
 *
 * What is under test stays real: the same `buildHttpLoggingOptions` the
 * application ships, the same serializers, the same redaction, driven by real
 * HTTP requests through real Nest. Only the sink is swapped.
 */
const emitted: string[] = [];
const captureStream = {
  write(line: string): void {
    emitted.push(line);
  },
};

function drainLogs(): Record<string, unknown>[] {
  const parsed = emitted.flatMap((line) => {
    try {
      const value: unknown = JSON.parse(line);
      return isLogEntry(value) ? [value] : [];
    } catch {
      return [];
    }
  });
  emitted.length = 0;
  return parsed;
}

function isLogEntry(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function rawLogs(): string {
  return emitted.join('');
}

function testLoggingSettings(): LoggingSettings {
  return {
    level: 'info',
    format: 'json',
    pretty: false,
    serviceName: 'eventini-api',
    serviceVersion: '0.0.1',
    redactionEnabled: true,
    httpEnabled: true,
    httpSuccessEnabled: true,
    slowRequestThresholdMs: 1000,
    slowQueryThresholdMs: 500,
    debugModules: undefined,
    debugExpiresAt: undefined,
    environment: 'test',
    instanceId: 'test-instance',
  };
}

describe('Pino logging (EVT-011)', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestRootModule],
    })
      .overrideProvider(PARAMS_PROVIDER_TOKEN)
      .useValue({
        pinoHttp: [
          buildHttpLoggingOptions(testLoggingSettings()),
          captureStream,
        ],
      })
      .compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      bufferLogs: true,
    });
    app.useLogger(app.get(Logger));
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(buildValidationPipe());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    emitted.length = 0;
  });

  it('writes one NDJSON line per request with the §9 canonical fields', async () => {
    await request(app.getHttpServer()).get('/api/v1/probe/ok');

    const access = drainLogs().find(
      (entry) => entry.eventCode === 'HTTP_REQUEST_COMPLETED',
    );

    expect(access).toBeDefined();
    expect(access).toMatchObject({
      service: 'eventini-api',
      environment: 'test',
      instanceId: 'test-instance',
      category: 'HTTP_ACCESS',
      level: 'info',
    });
    expect(access?.requestId).toEqual(expect.any(String));
    expect(access?.responseTime).toEqual(expect.any(Number));
  });

  // §39.6 — the ID in the log must be the ID the caller was given back.
  it('logs the same requestId the client supplied and the response returned', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/probe/ok')
      .set('X-Request-Id', 'client-correlation-id-1');

    expect(response.headers['x-request-id']).toBe('client-correlation-id-1');

    const access = drainLogs().find(
      (entry) => entry.eventCode === 'HTTP_REQUEST_COMPLETED',
    );
    expect(access?.requestId).toBe('client-correlation-id-1');
  });

  // §39.3 — no body, and no credential-bearing header, in the access log.
  it('never logs request headers that carry credentials', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/probe/ok')
      .set('Authorization', `Bearer ${CANARY}`)
      .set('Cookie', `session=${CANARY}`);

    expect(rawLogs()).not.toContain(CANARY);
  });

  // §31 — a token in a query string must not survive into the access log.
  it('never logs a query string', async () => {
    await request(app.getHttpServer()).get(
      `/api/v1/probe/search?token=${CANARY}`,
    );

    expect(rawLogs()).not.toContain(CANARY);
  });

  /**
   * Regression: the exception filter built its `operation` field (and the
   * RFC 9457 `instance`) from `originalUrl`, query string included, so a
   * request to an unmatched route with a token in the query wrote
   * `"operation":"GET /api/v1/nope?token=…"` into the log store. Found by
   * booting the real server and grepping its stdout for a canary, not by any
   * test that existed at the time.
   */
  it('never logs a query string on the error path either', async () => {
    const response = await request(app.getHttpServer()).get(
      `/api/v1/does-not-exist?token=${CANARY}`,
    );

    expect(rawLogs()).not.toContain(CANARY);
    // The same value must not come back in the response body's `instance`.
    expect(JSON.stringify(response.body)).not.toContain(CANARY);
  });

  // §39.4 — stack in the log, never in the response; and exactly one line.
  it('logs a 5xx once at error level while the response stays generic', async () => {
    const response = await request(app.getHttpServer()).get(
      '/api/v1/probe/boom',
    );

    expect(JSON.stringify(response.body)).not.toContain(CANARY);

    const failures = drainLogs().filter(
      (entry) => entry.eventCode === 'UNHANDLED_APPLICATION_ERROR',
    );

    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({
      level: 'error',
      category: 'APPLICATION',
      errorCode: 'INTERNAL_ERROR',
      result: 'FAILURE',
    });
    // The stack belongs in the log store, which is exactly where it is.
    expect(JSON.stringify(failures[0]?.err)).toContain('stack');
  });

  it('does not log health and metrics probes', async () => {
    await request(app.getHttpServer()).get('/api/v1/health/live');

    expect(
      drainLogs().filter(
        (entry) => entry.eventCode === 'HTTP_REQUEST_COMPLETED',
      ),
    ).toHaveLength(0);
  });
});
