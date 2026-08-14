import { Controller, Get, Header, Res } from '@nestjs/common';
import type { Response } from 'express';

// From the file rather than the barrel, so this controller does not drag in
// `common/api`'s exception filter, which imports `MetricsService` from here.
import { RawResponse } from '../../common/api/raw-response.decorator';
import { MetricsService } from './metrics.service';

/**
 * The Prometheus scrape endpoint.
 *
 * `@RawResponse()` is mandatory here, not cosmetic: Prometheus parses the
 * text exposition format and rejects anything else, so wrapping this body in
 * the `data`/`meta`/`error` envelope would not degrade monitoring, it would
 * switch it off.
 *
 * The `Content-Type` is taken from the registry rather than hard-coded, so it
 * stays correct if prom-client moves to OpenMetrics. That needs the response
 * object, hence `@Res({ passthrough: true })` — passthrough keeps Nest in
 * charge of sending the body, so the handler stays a plain function returning
 * a string and the interceptor chain still runs.
 *
 * Unauthenticated by design, and exempt from CSRF per ADR-0016. It is
 * expected to be unreachable from outside the cluster; exposure is an ingress
 * concern, and EVT-013 is where that is settled. Nothing here carries tenant
 * or personal data — §36's label allowlist guarantees it, and
 * `assertAllowedLabels` enforces it at startup.
 */
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  @RawResponse()
  @Header('Cache-Control', 'no-store')
  async scrape(
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    response.type(this.metricsService.contentType);
    return this.metricsService.render();
  }
}
