import { Global, Module } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';

import { loggingConfig } from '../../config/logging.config';
import { buildHttpLoggingOptions } from './http-logging.config';
import { RequestContextInterceptor } from './request-context.interceptor';
import { RequestContextService } from './request-context.service';

/**
 * The single logging subsystem — §41 rule 3 ("éviter un second logger").
 *
 * `nestjs-pino`'s `LoggerModule` provides both the injectable `Logger`
 * (which replaces Nest's own in `main.ts`) and the `pino-http` middleware
 * that emits one line per request.
 *
 * Global, because `RequestContextService` has to be reachable from guards and
 * use cases in every feature module. The alternative — importing
 * `LoggingModule` into all fifteen — is the kind of ceremony that gets
 * skipped, and a module that skips it silently loses its tenant context.
 */
@Global()
@Module({
  imports: [
    LoggerModule.forRootAsync({
      // The namespace token is injected directly rather than going through
      // `ConfigService`. Importing `ConfigModule` here would construct a
      // *second*, unconfigured instance with none of `AppModule`'s `load`
      // namespaces, and `getOrThrow('CONFIGURATION(logging)')` would then
      // throw at boot. `ConfigModule.forRoot({ isGlobal: true })` already
      // publishes this token application-wide.
      inject: [loggingConfig.KEY],
      useFactory: (settings: ConfigType<typeof loggingConfig>) => {
        const pinoHttp = buildHttpLoggingOptions(settings);

        // When HTTP access logging is off, only the automatic request/response
        // line is suppressed — the per-request child logger still exists, so
        // application logs keep their `requestId`. `exclude` would drop the
        // context too, which is not what LOG_HTTP_ENABLED=false should mean.
        if (!settings.httpEnabled) {
          pinoHttp.autoLogging = false;
        }

        // nestjs-pino defaults its middleware to `path: '*'`, which the
        // path-to-regexp version @nestjs/core now uses rejects, emitting a
        // `LegacyRouteConverter` deprecation warning on every boot. The
        // named-wildcard form is the replacement Nest's own warning names.
        return { pinoHttp, forRoutes: ['*path'] };
      },
    }),
  ],
  providers: [RequestContextService, RequestContextInterceptor],
  exports: [RequestContextService, RequestContextInterceptor],
})
export class LoggingModule {}
