import { Counter, Gauge, Histogram, type Registry } from 'prom-client';

import { assertAllowedLabels } from './assert-allowed-labels';
import {
  HTTP_DURATION_BUCKETS_SECONDS,
  JOB_DURATION_BUCKETS_SECONDS,
} from './metrics.constants';

/**
 * The eleven metrics named in PINO_LOGGING_SPECIFICATION.md §36.
 *
 * ## Why all eleven exist from day one, including the ones nothing increments
 *
 * A Prometheus alert on `rate(login_failures_total[5m])` does not fire when
 * the series is *absent* — it evaluates to no data, and an alert that never
 * fires looks identical to a system that is fine. Registering every metric up
 * front, at zero, means the dashboards and alert rules written against §36
 * are valid the moment they are deployed, and each subsystem only has to
 * increment an already-existing handle when it lands.
 *
 * The ticket that will drive each currently-idle metric is named beside it, so
 * "unused" here is a scheduled state rather than an oversight.
 *
 * Every label set passes `assertAllowedLabels`, so a metric that would explode
 * the series count fails at module load rather than in production.
 */
export interface EventiniMetrics {
  readonly httpRequestsTotal: Counter<'route' | 'method' | 'status'>;
  readonly httpRequestDurationSeconds: Histogram<'route' | 'method' | 'status'>;
  readonly applicationErrorsTotal: Counter<'category' | 'eventCode'>;
  readonly securityEventsTotal: Counter<'eventCode'>;
  readonly loginFailuresTotal: Counter<'eventCode'>;
  readonly refreshTokenReuseTotal: Counter<string>;
  readonly queueJobsFailedTotal: Counter<'queueName'>;
  readonly queueJobDurationSeconds: Histogram<'queueName'>;
  readonly redisFallbackTotal: Counter<string>;
  readonly slowQueriesTotal: Counter<string>;
  readonly activeSseConnections: Gauge<string>;
}

function counter<T extends string>(
  registry: Registry,
  name: string,
  help: string,
  labelNames: readonly T[] = [],
): Counter<T> {
  assertAllowedLabels(name, labelNames);
  return new Counter({
    name,
    help,
    labelNames: [...labelNames],
    registers: [registry],
  });
}

function histogram<T extends string>(
  registry: Registry,
  name: string,
  help: string,
  buckets: number[],
  labelNames: readonly T[] = [],
): Histogram<T> {
  assertAllowedLabels(name, labelNames);
  return new Histogram({
    name,
    help,
    buckets,
    labelNames: [...labelNames],
    registers: [registry],
  });
}

function gauge<T extends string>(
  registry: Registry,
  name: string,
  help: string,
  labelNames: readonly T[] = [],
): Gauge<T> {
  assertAllowedLabels(name, labelNames);
  return new Gauge({
    name,
    help,
    labelNames: [...labelNames],
    registers: [registry],
  });
}

export function createMetrics(registry: Registry): EventiniMetrics {
  return {
    // Driven now, by HttpMetricsInterceptor.
    httpRequestsTotal: counter(
      registry,
      'http_requests_total',
      'HTTP requests completed, by route template, method and status.',
      ['route', 'method', 'status'] as const,
    ),
    httpRequestDurationSeconds: histogram(
      registry,
      'http_request_duration_seconds',
      'HTTP request duration in seconds, by route template, method and status.',
      HTTP_DURATION_BUCKETS_SECONDS,
      ['route', 'method', 'status'] as const,
    ),

    // Driven now, by HttpExceptionFilter.
    applicationErrorsTotal: counter(
      registry,
      'application_errors_total',
      'Application errors handled by the global exception filter.',
      ['category', 'eventCode'] as const,
    ),

    // EVT-020 onward — the security-events subsystem.
    securityEventsTotal: counter(
      registry,
      'security_events_total',
      'Security events recorded, by event code.',
      ['eventCode'] as const,
    ),
    loginFailuresTotal: counter(
      registry,
      'login_failures_total',
      'Failed authentication attempts, by reason code.',
      ['eventCode'] as const,
    ),
    refreshTokenReuseTotal: counter(
      registry,
      'refresh_token_reuse_total',
      'Refresh-token replays detected, each of which revokes a token family.',
    ),

    // EVT-026 onward — BullMQ.
    queueJobsFailedTotal: counter(
      registry,
      'queue_jobs_failed_total',
      'Queue jobs that exhausted their retries.',
      ['queueName'] as const,
    ),
    queueJobDurationSeconds: histogram(
      registry,
      'queue_job_duration_seconds',
      'Queue job execution time in seconds.',
      JOB_DURATION_BUCKETS_SECONDS,
      ['queueName'] as const,
    ),

    // EVT-016 onward — Redis, and the degraded mode it falls back to.
    redisFallbackTotal: counter(
      registry,
      'redis_fallback_total',
      'Times a Redis-backed path fell back to its degraded behaviour.',
    ),

    // EVT-014 onward — Prisma, against LOG_SLOW_QUERY_THRESHOLD_MS.
    slowQueriesTotal: counter(
      registry,
      'slow_queries_total',
      'Database queries slower than the configured slow-query threshold.',
    ),

    // EVT-050 onward — realtime.
    activeSseConnections: gauge(
      registry,
      'active_sse_connections',
      'Server-sent-event connections currently open.',
    ),
  };
}
