import {
  Global,
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';

import { loggingConfig } from '../../config/logging.config';
import { HttpMetricsMiddleware } from './http-metrics.middleware';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';

/**
 * Prometheus metrics — sprint-02 EVT-012, PINO_LOGGING_SPECIFICATION.md §36.
 *
 * Global, because any module that needs to increment a counter should inject
 * `MetricsService` without importing this one. Requiring fifteen modules to
 * remember an import is how metrics end up half-instrumented.
 *
 * `serviceName`/`environment` come from the logging namespace rather than a
 * new one: they are the same two values §9.1 already puts on every log line,
 * and a second source for them would be a second thing to get out of sync.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [
    {
      provide: MetricsService,
      inject: [loggingConfig.KEY],
      useFactory: (settings: ConfigType<typeof loggingConfig>) =>
        new MetricsService(settings.serviceName, settings.environment),
    },
    HttpMetricsMiddleware,
  ],
  exports: [MetricsService],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // `*path` is the path-to-regexp v8 wildcard; the bare `*` that older
    // Nest examples use is deprecated and warns on every boot.
    consumer.apply(HttpMetricsMiddleware).forRoutes('*path');
  }
}
