import { Injectable } from '@nestjs/common';
import { Registry, collectDefaultMetrics } from 'prom-client';

import { createMetrics, type EventiniMetrics } from './metric-definitions';

/**
 * Owns the Prometheus registry and the eleven §36 metrics.
 *
 * A dedicated `Registry` rather than prom-client's global default: the global
 * one is process-wide module state, so two Nest applications in the same Jest
 * worker — which is exactly what an e2e suite creates — would collide on
 * "metric already registered" and fail in a way that has nothing to do with
 * the code under test. An owned registry also means `/metrics` serves only
 * what this application declared.
 *
 * Default metrics (event-loop lag, heap, GC, file descriptors) are collected
 * too. They are what distinguishes "the service is slow" from "the host is
 * slow", and no application code has to remember to record them.
 */
@Injectable()
export class MetricsService {
  readonly registry: Registry;
  readonly metrics: EventiniMetrics;

  constructor(serviceName: string, environment: string) {
    this.registry = new Registry();

    // `service` and `environment` are on §36's allowlist and are constant per
    // process, so as default labels they add no cardinality at all while
    // making a multi-environment Prometheus queryable without every rule
    // having to join against something else.
    this.registry.setDefaultLabels({
      service: serviceName,
      environment,
    });

    collectDefaultMetrics({ register: this.registry });
    this.metrics = createMetrics(this.registry);
  }

  /** The exposition payload, in Prometheus text format. */
  async render(): Promise<string> {
    return this.registry.metrics();
  }

  get contentType(): string {
    return this.registry.contentType;
  }
}
