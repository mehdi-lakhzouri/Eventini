import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../../src/app.module';
import { buildValidationPipe } from '../../src/bootstrap';
import {
  DatabaseHealthIndicator,
  RedisHealthIndicator,
} from '../../src/infrastructure/health';

/**
 * Both indicators are replaced so readiness is deterministic without a live
 * PostgreSQL or Redis. Everything else is real — the controller, Terminus,
 * the global interceptors, the exception filter — so this covers the wiring
 * and the response contracts. A real round trip against the service
 * containers belongs in the integration suite (sprint 03).
 */
function stubIndicator(key: string, up: boolean) {
  return {
    isHealthy: () =>
      Promise.resolve({
        [key]: up
          ? { status: 'up' }
          : { status: 'down', reason: 'unreachable' },
      }),
  };
}

async function createApp(options: {
  databaseUp: boolean;
  redisUp: boolean;
}): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DatabaseHealthIndicator)
    .useValue(stubIndicator('database', options.databaseUp))
    .overrideProvider(RedisHealthIndicator)
    .useValue(stubIndicator('redis', options.redisUp))
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: false,
  });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(buildValidationPipe());
  await app.init();
  return app;
}

describe('health and metrics (EVT-012)', () => {
  describe('with every dependency up', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createApp({ databaseUp: true, redisUp: true });
    });
    afterAll(async () => {
      await app.close();
    });

    it('answers liveness with 200', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/live',
      );

      expect(response.status).toBe(200);
    });

    it('answers readiness with 200 and names each dependency', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/ready',
      );

      expect(response.status).toBe(200);
      const body = response.body as { data: { status: string; info: object } };
      expect(body.data.status).toBe('ok');
      expect(body.data.info).toHaveProperty('database');
      expect(body.data.info).toHaveProperty('redis');
    });

    it('answers startup with 200 once bootstrap has completed', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/startup',
      );

      expect(response.status).toBe(200);
    });

    it('wraps health responses in the ADR-0008 envelope', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/live',
      );

      expect(response.body).toMatchObject({
        data: { status: 'ok' },
        meta: { apiVersion: 'v1' },
        error: null,
      });
    });

    describe('/metrics', () => {
      it('serves Prometheus text, NOT the JSON envelope', async () => {
        const response = await request(app.getHttpServer()).get(
          '/api/v1/metrics',
        );

        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('text/plain');
        // The envelope would make this unparseable by Prometheus.
        expect(response.text).not.toContain('"data"');
        expect(response.text).toMatch(/^# HELP/m);
      });

      it('exposes the §36 metric names', async () => {
        const { text } = await request(app.getHttpServer()).get(
          '/api/v1/metrics',
        );

        for (const name of [
          'http_requests_total',
          'http_request_duration_seconds',
          'application_errors_total',
          'security_events_total',
          'login_failures_total',
          'refresh_token_reuse_total',
          'queue_jobs_failed_total',
          'queue_job_duration_seconds',
          'redis_fallback_total',
          'slow_queries_total',
          'active_sse_connections',
        ]) {
          expect(text).toContain(name);
        }
      });

      it('records requests against the route template, never a concrete path', async () => {
        await request(app.getHttpServer()).get('/api/v1/health/live');
        const { text } = await request(app.getHttpServer()).get(
          '/api/v1/metrics',
        );

        // Express reports the fully-mounted route, global prefix included.
        expect(text).toContain('route="/api/v1/health/live"');
      });

      /**
       * §36's cardinality rule. A path-valued `route` label would create one
       * series per identifier and take the metrics backend down.
       */
      it('buckets unmatched routes rather than recording their paths', async () => {
        await request(app.getHttpServer()).get(
          '/api/v1/no-such-route-abc123xyz',
        );
        const { text } = await request(app.getHttpServer()).get(
          '/api/v1/metrics',
        );

        expect(text).not.toContain('no-such-route-abc123xyz');
        expect(text).toContain('route="unmatched"');
      });

      it('counts handled errors in application_errors_total', async () => {
        await request(app.getHttpServer()).get('/api/v1/definitely-missing');
        const { text } = await request(app.getHttpServer()).get(
          '/api/v1/metrics',
        );

        expect(text).toMatch(/application_errors_total\{[^}]*\} [1-9]/);
      });

      it('carries no tenant or personal label', async () => {
        const { text } = await request(app.getHttpServer()).get(
          '/api/v1/metrics',
        );

        for (const forbidden of [
          'userId',
          'email',
          'sessionId',
          'requestId',
          'organizationId',
        ]) {
          expect(text).not.toContain(`${forbidden}=`);
        }
      });
    });
  });

  describe('with Redis down', () => {
    let app: NestExpressApplication;

    beforeAll(async () => {
      app = await createApp({ databaseUp: true, redisUp: false });
    });
    afterAll(async () => {
      await app.close();
    });

    /**
     * The behaviour this whole ticket turns on. If liveness followed
     * readiness here, the orchestrator would kill the pod, restart it, find
     * Redis still down, and loop — an outage manufactured out of a degraded
     * dependency.
     */
    it('keeps liveness green so the orchestrator does not restart the pod', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/live',
      );

      expect(response.status).toBe(200);
    });

    it('fails readiness with 503 so the instance leaves the routing pool', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/ready',
      );

      expect(response.status).toBe(503);
    });

    /**
     * The diagnostic value of the probe. Terminus signals failure by
     * throwing, and left alone that throw reaches the global exception filter,
     * which maps any unrecognised exception to a bare `DEPENDENCY_UNAVAILABLE`
     * — correct status, breakdown discarded, so an operator learns that *a*
     * dependency is missing but not *which*. This asserts the breakdown
     * survives.
     */
    it('names the failing dependency, and only that one', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/ready',
      );

      const body = response.body as {
        error: {
          code: string;
          retryable: boolean;
          errors: Array<{ field: string; code: string }>;
        };
      };

      expect(body.error.code).toBe('DEPENDENCY_UNAVAILABLE');
      expect(body.error.retryable).toBe(true);
      expect(body.error.errors).toEqual([
        expect.objectContaining({ field: 'redis', code: 'DEPENDENCY_DOWN' }),
      ]);
      // The healthy dependency is not listed — only what is actually down.
      expect(body.error.errors.map((entry) => entry.field)).not.toContain(
        'database',
      );
    });

    it('keeps the RFC 9457 envelope on the failure path', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/ready',
      );

      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.body).toMatchObject({
        data: null,
        meta: { apiVersion: 'v1' },
      });
    });

    it('keeps startup green — a dependency outage is not a failed boot', async () => {
      const response = await request(app.getHttpServer()).get(
        '/api/v1/health/startup',
      );

      expect(response.status).toBe(200);
    });
  });
});
