import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';

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
import { createBootstrapLogger } from './infrastructure/logging';

/**
 * The process-level logger: same NDJSON shape and same §9.1 base fields as
 * the injected one, but owned by the process rather than the DI container.
 *
 * Used for the two moments the container cannot serve — the startup line
 * (`PinoLogger` is request-scoped, `app.get()` refuses it) and the fatal
 * handlers below, which can fire before the container exists or after it has
 * broken.
 */
const processLogger = createBootstrapLogger();

/**
 * Bootstrap order follows BACKEND_ARCHITECTURE.md §4 exactly. Every step here
 * is a security boundary, not an arbitrary preference — see the inline
 * rationale at each call.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Holds startup logs until `useLogger` below, so they go through Pino
    // and its redaction rather than escaping to a raw console writer
    // (PINO_LOGGING_SPECIFICATION.md §17).
    bufferLogs: true,
  });

  // Before anything else logs: Pino becomes the one logger, per §41 rule 3.
  app.useLogger(app.get(Logger));

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

  // The response envelope interceptor and the RFC 9457 exception filter are
  // registered as APP_INTERCEPTOR/APP_FILTER providers in `app.module.ts`,
  // not here: both need DI now that the filter logs through the
  // request-scoped Pino logger. Same global scope, dependencies satisfied.

  if (application.swaggerEnabled) {
    setupSwagger(app);
  }

  // Runs onModuleDestroy/beforeApplicationShutdown on every provider when the
  // process receives SIGTERM/SIGINT, instead of the default hard stop that
  // would cut transactions mid-flight and leave BullMQ jobs orphaned.
  app.enableShutdownHooks();

  await app.listen(application.port);

  // Logged through the process-level logger, not an injected one.
  //
  // Two things rule the injected loggers out here. `PinoLogger` is a
  // request-scoped provider, so `app.get()` on it throws outright ("Request
  // and transient-scoped providers can't be used in combination with get()").
  // And nestjs-pino's `Logger` implements Nest's `LoggerService`, whose
  // signature is `log(message, ...meta, context)` — passing
  // `(fields, 'Application started')` there filed the message as the
  // `context` and dropped `msg` entirely. Both observed in real boot output.
  //
  // `processLogger` has Pino's own `(mergingObject, message)` order and the
  // same base fields, which is what a structured startup line needs.
  processLogger.info(
    { eventCode: 'APPLICATION_STARTED', category: 'SYSTEM' },
    'Application started',
  );
}

/**
 * Fatal-error handling — PINO_LOGGING_SPECIFICATION.md §29.
 *
 * All three paths below log `fatal` through `processLogger` and exit
 * non-zero. The process-level logger is used rather than an injected one
 * because two of these can fire before the DI container exists (an invalid
 * environment throws inside `NestFactory.create` itself), and because after
 * an `uncaughtException` the container may be exactly what is broken.
 *
 * §29 asks for a graceful ten-step drain — stop accepting requests, close
 * HTTP, Prisma, Redis, workers, then flush. `enableShutdownHooks()` already
 * covers the SIGTERM/SIGINT path, which is how a deployment normally ends. On
 * an *uncaught* error the state is by definition unknown, and §29's own
 * closing line is the deciding one: "Ne pas continuer après un état
 * potentiellement corrompu." So these paths flush the log and exit rather
 * than attempting an orderly drain through subsystems that may be the thing
 * that just failed. Prisma and Redis close in EVT-012/EVT-013 as part of the
 * graceful path, where draining is actually safe.
 */
function exitFatal(eventCode: string, error: unknown): never {
  processLogger.fatal(
    { eventCode, category: 'SYSTEM', err: error },
    'Fatal error, shutting down',
  );
  // Pino writes asynchronously; without this the process can exit before the
  // line reaches stdout, losing the one log that explains the crash.
  processLogger.flush();
  process.exit(1);
}

process.on('uncaughtException', (error: Error) => {
  exitFatal('UNCAUGHT_EXCEPTION', error);
});

process.on('unhandledRejection', (reason: unknown) => {
  exitFatal('UNHANDLED_REJECTION', reason);
});

bootstrap().catch((error: unknown) => {
  exitFatal('APPLICATION_START_FAILED', error);
});
