import {
  ALLOWED_METRIC_LABELS,
  FORBIDDEN_METRIC_LABELS,
} from './metrics.constants';

const ALLOWED = new Set<string>(ALLOWED_METRIC_LABELS);
const FORBIDDEN = new Set<string>(FORBIDDEN_METRIC_LABELS);

/**
 * Refuses a metric whose labels are not on the allowlist.
 *
 * Runs at module load, where the metrics are defined, so an unbounded label
 * fails the process at startup instead of quietly multiplying series until
 * the metrics backend falls over — by which time the cause is weeks of
 * commits away. This is the same fail-closed reasoning as the environment
 * rules: a startup that refuses is cheap, a metrics store that dies under
 * cardinality is not.
 */
export function assertAllowedLabels(
  metricName: string,
  labelNames: readonly string[],
): void {
  for (const label of labelNames) {
    if (ALLOWED.has(label)) {
      continue;
    }

    const reason = FORBIDDEN.has(label)
      ? `"${label}" has an unbounded value space — one time series per distinct value would be created`
      : `"${label}" is not on the allowlist`;

    throw new Error(
      `Metric "${metricName}" declares a disallowed label: ${reason}. ` +
        `Allowed labels: ${ALLOWED_METRIC_LABELS.join(', ')}. ` +
        `See PINO_LOGGING_SPECIFICATION.md §36.`,
    );
  }
}
