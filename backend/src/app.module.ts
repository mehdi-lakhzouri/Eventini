import { config as loadDotenvFile } from 'dotenv';

import {
  Module,
  type MiddlewareConsumer,
  type NestModule,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';

import { configurationNamespaces, validateEnvironment } from './config';
import { HttpExceptionFilter, ResponseEnvelopeInterceptor } from './common/api';
import { RequestIdMiddleware } from './common/middleware';
import { PrismaModule } from './infrastructure/database';
import { EmailModule } from './infrastructure/email';
import { HealthModule } from './infrastructure/health';
import {
  LoggingModule,
  RequestContextInterceptor,
} from './infrastructure/logging';
import { MetricsModule } from './infrastructure/metrics';
import { RedisModule } from './infrastructure/redis';
import { GuardChainModule } from './modules/identity/authorization/guard-chain.module';
import { OrganizationsModule } from './modules/organizations';
import { EventsModule } from './modules/events';
import { EventSessionsModule } from './modules/event-sessions';
import { RateLimitingModule } from './modules/rate-limiting';
import { IdentityModule } from './modules/identity';

/**
 * `ConfigModule.forRoot`'s own env-file loading, below, writes its *validated*
 * (type-coerced) result back into `process.env` for every key not already
 * present there — that is `@nestjs/config`'s own `assignVariablesToProcess`.
 * Every `registerAs` factory in `./config` calls `getValidatedEnv()`, which
 * re-parses `process.env` a *second* time through the same validator. If
 * these keys were not already in `process.env`, that second pass receives
 * the coerced values instead of the original strings — a duration rewritten
 * as raw milliseconds, an array dropped entirely (arrays cannot round-trip
 * through `process.env`) — and fails to parse them. Confirmed by tracing a
 * real `NestFactory.create()` failure: `ACCESS_TOKEN_TTL_WEB_ADMIN` arrived
 * at the second pass as `"600000"` instead of `"10m"`.
 *
 * Loading the file into `process.env` ourselves, first, makes every key
 * already present by the time `ConfigModule.forRoot` runs, so its write-back
 * becomes a no-op and the second pass sees the same untouched strings as the
 * first.
 */
const isProduction = process.env.NODE_ENV === 'production';
if (!isProduction) {
  loadDotenvFile({ path: '.env' });
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: configurationNamespaces,
      // Runs before anything else is constructed. A failure throws and the
      // process exits non-zero rather than starting half-configured.
      validate: validateEnvironment,
      // .env is for local development only; deployed environments inject real
      // variables. Ignoring the file in production stops a stray one on the
      // host from quietly overriding them.
      envFilePath: ['.env'],
      ignoreEnvFile: isProduction,
      cache: true,
      // No `expandVariables`: interpolation would let one secret reference
      // another, which is exactly what the reuse check (rule 8) exists to catch.
    }),
    LoggingModule,
    MetricsModule,
    // Ahead of HealthModule: the database readiness indicator injects
    // PrismaService, so the module providing it has to be constructed first.
    PrismaModule,
    // Ahead of everything that rate-limits or locks out: `RedisScriptRegistry`
    // loads the four Lua scripts in its `onModuleInit`, and a failure there is
    // fatal by design (REDIS_KEYS_AND_LUA_SCRIPTS.md §6) — the application must
    // not start able to serve `/auth/sessions` with no limiter behind it.
    RedisModule,
    EmailModule,
    HealthModule,
    // Ahead of IdentityModule, and the order is load-bearing: Nest runs
    // APP_GUARD providers in registration order, so this is what puts
    // RateLimitGuard in front of CsrfGuard. §7.5 requires rate limiting to run
    // before CSRF, before validation and above all before Argon2id — a login
    // endpoint that hashes first and counts afterwards is its own DoS vector.
    RateLimitingModule,
    IdentityModule,
    // After IdentityModule, and that is deliberate: APP_GUARD providers run in
    // module initialisation order, so this is what puts the authorization
    // chain behind rate limiting and CSRF (§7.5).
    GuardChainModule,
    OrganizationsModule,
    EventsModule,
    EventSessionsModule,
  ],
  providers: [
    // Registered here rather than in `main.ts` because all three need DI:
    // the filter and the context interceptor resolve the request-scoped Pino
    // logger. Order matters for interceptors — `RequestContextInterceptor`
    // is listed first so correlation fields are on the logger before any
    // handler runs and can log.
    { provide: APP_INTERCEPTOR, useClass: RequestContextInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseEnvelopeInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Ahead of every route, so a request ID exists for the logger (EVT-011),
    // the response envelope, and the exception filter alike. `*path` is the
    // path-to-regexp v8 wildcard `@nestjs/core` now expects -- the bare `*`
    // Express/Nest examples still show elsewhere is deprecated and only
    // auto-converts with a warning.
    consumer.apply(RequestIdMiddleware).forRoutes('*path');
  }
}
