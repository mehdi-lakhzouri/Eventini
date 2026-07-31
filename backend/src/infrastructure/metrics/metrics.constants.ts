/**
 * The only label names any Eventini metric may carry — sprint-02 EVT-012 and
 * PINO_LOGGING_SPECIFICATION.md §36.
 *
 * A Prometheus time series exists per unique label-value combination, so a
 * label whose value space is unbounded multiplies storage without bound. That
 * is why `userId`, `email`, `sessionId`, `requestId` and `organizationId` are
 * forbidden: one series per user is not a metric, it is a database, and it
 * takes the metrics backend down with it.
 *
 * This is enforced, not merely documented — `assertAllowedLabels` throws at
 * module load if a definition names anything else, so the mistake cannot
 * reach production.
 */
export const ALLOWED_METRIC_LABELS = [
  'route',
  'method',
  'status',
  'category',
  'eventCode',
  'queueName',
  'service',
  'environment',
] as const;

export type AllowedMetricLabel = (typeof ALLOWED_METRIC_LABELS)[number];

/**
 * Named explicitly so the failure message can say *why*, rather than only
 * that the label is not on the allowlist. These are the ones someone reaches
 * for by reflex when debugging.
 */
export const FORBIDDEN_METRIC_LABELS: readonly string[] = [
  'userId',
  'email',
  'sessionId',
  'requestId',
  'organizationId',
  'resourceId',
  'ip',
];

/**
 * Latency buckets in seconds.
 *
 * Chosen around the thresholds the project already cares about rather than
 * the prom-client default: `LOG_SLOW_REQUEST_THRESHOLD_MS` defaults to 1s, so
 * there are boundaries either side of it to make "how many requests crossed
 * the slow threshold" answerable, plus enough resolution below 250ms for the
 * range most authenticated reads should land in.
 */
export const HTTP_DURATION_BUCKETS_SECONDS = [
  0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10,
];

/** Job durations run far longer than requests, so they need their own scale. */
export const JOB_DURATION_BUCKETS_SECONDS = [
  0.1, 0.5, 1, 5, 15, 30, 60, 300, 900,
];

/** Route template used for requests that matched no route. */
export const UNMATCHED_ROUTE_LABEL = 'unmatched';
