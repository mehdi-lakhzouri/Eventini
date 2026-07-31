import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ConfigType } from '@nestjs/config';

import { AppModule } from './app.module';
import { applicationConfig, cookiesConfig } from './config';
import {
  buildCorsOptions,
  buildHelmetOptions,
  buildValidationPipe,
  permissionsPolicyMiddleware,
  setupSwagger,
} from './bootstrap';
import { HttpExceptionFilter, ResponseEnvelopeInterceptor } from './common/api';

/**
 * Bootstrap order follows BACKEND_ARCHITECTURE.md §4 exactly. Every step here
 * is a security boundary, not an arbitrary preference — see the inline
 * rationale at each call.
 *
 * One step from the target sequence is deliberately NOT here yet:
 * `app.useLogger(app.get(Logger))` — no Pino Logger provider exists until
 * EVT-011 fills `infrastructure/logging/`. Nest's built-in logger is used
 * meanwhile, which is correct, not a workaround.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  const application = app.get<ConfigType<typeof applicationConfig>>(
    applicationConfig.KEY,
  );
  const cookies = app.get<ConfigType<typeof cookiesConfig>>(cookiesConfig.KEY);

  // A hop count, NEVER `true`. With `true`, Express trusts whatever
  // X-Forwarded-For the client sends, and every IP-keyed rate limit and the
  // whole lockout ladder (ADR-0013) become trivially bypassable by forging
  // one header — the most common rate-limiting implementation error.
  app.set('trust proxy', application.trustedProxyHops);

  app.use(helmet(buildHelmetOptions()));
  app.use(permissionsPolicyMiddleware);

  app.enableCors(
    buildCorsOptions(
      application.corsAllowedOrigins,
      application.corsMaxAgeSeconds,
    ),
  );

  app.use(cookieParser(cookies.secret));

  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(buildValidationPipe());

  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());

  if (application.swaggerEnabled) {
    setupSwagger(app);
  }

  // Runs onModuleDestroy/beforeApplicationShutdown on every provider when the
  // process receives SIGTERM/SIGINT, instead of the default hard stop that
  // would cut transactions mid-flight and leave BullMQ jobs orphaned.
  app.enableShutdownHooks();

  await app.listen(application.port);
}

// A rejected bootstrap must terminate the process with a non-zero code so the
// orchestrator restarts, fails again, and marks the deployment failed. An
// unhandled rejection would leave a half-started process answering health
// probes it cannot honour — worse than not starting at all.
//
// Reporting this through Pino's `fatal` level and the ten-step shutdown of
// PINO_LOGGING_SPECIFICATION.md §29 is EVT-011's job, once a logger exists to
// report through. Until then, stderr and a non-zero exit are the honest
// approximation.
bootstrap().catch((error: unknown) => {
  console.error('Application bootstrap failed', error);
  process.exit(1);
});
