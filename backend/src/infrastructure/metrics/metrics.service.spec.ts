import { MetricsService } from './metrics.service';

/** The eleven names PINO_LOGGING_SPECIFICATION.md §36 fixes as the contract. */
const SPEC_36_METRICS = [
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
];

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    service = new MetricsService('eventini-api', 'test');
  });

  /**
   * Alert rules are written against these names. A rule on a series that does
   * not exist evaluates to no data and never fires, which is
   * indistinguishable from a healthy system — so the names existing at zero
   * is the actual requirement, not a nicety.
   */
  it.each(SPEC_36_METRICS)('registers %s', async (name) => {
    expect(await service.registry.getSingleMetricAsString(name)).toContain(
      name,
    );
  });

  it('exposes all eleven §36 metrics before anything increments them', async () => {
    const rendered = await service.render();

    for (const name of SPEC_36_METRICS) {
      expect(rendered).toContain(name);
    }
  });

  it('serves the Prometheus text exposition content type', () => {
    expect(service.contentType).toContain('text/plain');
  });

  it('labels every series with service and environment', async () => {
    service.metrics.refreshTokenReuseTotal.inc();

    expect(await service.render()).toContain(
      'service="eventini-api",environment="test"',
    );
  });

  it('collects default process metrics, which separate a slow service from a slow host', async () => {
    const rendered = await service.render();

    expect(rendered).toContain('process_cpu_user_seconds_total');
    expect(rendered).toContain('nodejs_eventloop_lag_seconds');
  });

  /**
   * prom-client's default registry is process-wide, so two instances sharing
   * it would throw "already registered" the second time an app boots in the
   * same Jest worker — which an e2e suite does routinely.
   */
  it('owns an isolated registry, so a second instance does not collide', () => {
    expect(() => new MetricsService('eventini-api', 'test')).not.toThrow();
  });
});
