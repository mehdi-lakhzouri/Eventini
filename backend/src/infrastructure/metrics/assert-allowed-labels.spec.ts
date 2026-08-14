import { assertAllowedLabels } from './assert-allowed-labels';
import {
  ALLOWED_METRIC_LABELS,
  FORBIDDEN_METRIC_LABELS,
} from './metrics.constants';

describe('assertAllowedLabels', () => {
  it('accepts every label on the §36 allowlist', () => {
    expect(() =>
      assertAllowedLabels('some_metric', ALLOWED_METRIC_LABELS),
    ).not.toThrow();
  });

  it('accepts a metric with no labels', () => {
    expect(() => assertAllowedLabels('some_metric', [])).not.toThrow();
  });

  /**
   * The failure mode this guards against is not a wrong number on a
   * dashboard — it is one time series per user, which takes the metrics
   * backend down. Failing at module load is the only point where that is
   * cheap to fix.
   */
  it.each(FORBIDDEN_METRIC_LABELS)(
    'rejects the unbounded label %s',
    (label) => {
      expect(() => assertAllowedLabels('some_metric', [label])).toThrow(
        /unbounded value space/,
      );
    },
  );

  it('rejects an unknown label that is merely not on the allowlist', () => {
    expect(() => assertAllowedLabels('some_metric', ['tenantSlug'])).toThrow(
      /not on the allowlist/,
    );
  });

  it('names the metric and points at the spec, so the fix is obvious', () => {
    expect(() =>
      assertAllowedLabels('login_failures_total', ['email']),
    ).toThrow(/login_failures_total.*§36/s);
  });

  it('rejects as soon as any one label is disallowed', () => {
    expect(() =>
      assertAllowedLabels('mixed', ['route', 'method', 'userId']),
    ).toThrow(/userId/);
  });
});
