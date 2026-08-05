import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request, Response } from 'express';
import { PinoLogger } from 'nestjs-pino';

import { AppException } from '../../common/api/app-exception';
import { rateLimitConfig } from '../../config/rate-limit.config';
import { clientIpOf } from './domain/client-ip';
import {
  strictestOf,
  type RateLimitDecision,
} from './domain/rate-limit.decision';
import {
  failsClosed,
  rulesFor,
  type RequestFacts,
} from './domain/rate-limit.policy';
import { jitteredRetryAfter } from './domain/retry-after';
import { SlidingWindowLimiter } from './infrastructure/sliding-window.limiter';

/** Health and metrics only; anything that accepts credentials is limited. */
const EXEMPT_PATHS = [
  '/health/live',
  '/health/ready',
  '/health/startup',
  '/metrics',
];

/**
 * Layer 1 to 4 of §2, applied before anything expensive runs.
 *
 * This guard is registered ahead of `CsrfGuard`, and the order is the point:
 * §7.5 puts rate limiting before CSRF, before body validation and above all
 * before Argon2id. A verification costs 19 MiB and roughly 60 ms, so a login
 * endpoint that hashes first and counts afterwards is its own memory-exhaustion
 * vector. Invariant O-4 exists for this and nothing else.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly limiter: SlidingWindowLimiter,
    private readonly logger: PinoLogger,
    @Inject(rateLimitConfig.KEY)
    private readonly settings: ConfigType<typeof rateLimitConfig>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<Request>();

    if (isExempt(request)) {
      return true;
    }

    const facts = factsOf(request);
    const rules = rulesFor(facts, {
      globalPerIp: this.settings.global.perIp,
      // §3's stricter public ceiling: there is no legitimate reason for a high
      // anonymous volume, and this is the layer scraping meets first.
      globalPerUnauthenticatedIp: 60,
      loginPerIpAndEmail: this.settings.login.perIpAndEmail,
      loginWindowMs: this.settings.login.windowMs,
      loginPerIp: this.settings.login.perIp,
      mfaVerify: this.settings.mfaVerify,
      refresh: this.settings.refresh,
      passwordResetPerEmail: this.settings.passwordResetPerEmail,
    });

    const decision = await this.decide(rules, facts);

    this.writeHeaders(http.getResponse<Response>(), decision);

    if (!decision.allowed) {
      const retryAfter = jitteredRetryAfter(decision.retryAfterSeconds);
      http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));

      // The detail never names the dimension that tripped. Saying "per-email
      // limit reached" would confirm the address belongs to an account.
      throw new AppException('RATE_LIMIT_EXCEEDED', {
        detail: `Too many requests. Retry after ${String(retryAfter)} seconds.`,
        retryable: true,
      });
    }

    return true;
  }

  /**
   * §7.4's split. A limiter that cannot reach Redis must not take the product
   * offline, but must never become an open door: authentication refuses, and
   * everything else proceeds with a loud log so an event in progress keeps
   * running.
   */
  private async decide(
    rules: ReturnType<typeof rulesFor>,
    facts: RequestFacts,
  ): Promise<RateLimitDecision> {
    try {
      const decisions = await Promise.all(
        rules.map((rule) => this.limiter.check(rule)),
      );

      return strictestOf(decisions);
    } catch (error: unknown) {
      const closed = failsClosed(facts);

      this.logger.error(
        {
          err: error,
          category: 'SECURITY',
          eventCode: 'RATE_LIMIT_BACKEND_UNAVAILABLE',
          failMode: closed ? 'CLOSED' : 'OPEN',
          path: facts.path,
        },
        'Rate limiter backend unavailable',
      );

      if (closed) {
        throw new AppException('DEPENDENCY_UNAVAILABLE', { retryable: true });
      }

      return { allowed: true, limit: 0, remaining: 0, retryAfterSeconds: 0 };
    }
  }

  private writeHeaders(response: Response, decision: RateLimitDecision): void {
    if (decision.limit === 0) {
      return;
    }

    response.setHeader('RateLimit-Limit', String(decision.limit));
    response.setHeader('RateLimit-Remaining', String(decision.remaining));
    response.setHeader('RateLimit-Reset', String(decision.retryAfterSeconds));
  }
}

function isExempt(request: Request): boolean {
  const path = pathOf(request);

  return EXEMPT_PATHS.some(
    (exempt) => path === exempt || path.startsWith(`${exempt}/`),
  );
}

function factsOf(request: Request): RequestFacts {
  const body = request.body as Record<string, unknown> | undefined;
  const email = typeof body?.email === 'string' ? body.email : null;

  return {
    method: request.method,
    path: pathOf(request),
    ip: clientIpOf(request),
    // The access cookie is only evidence of an attempt, not of a valid
    // session: this runs before authentication. It is enough to choose
    // between the public and authenticated global ceilings, and a forged
    // cookie only buys the *stricter* treatment of an authenticated caller.
    authenticated: request.headers.cookie?.includes('_access=') === true,
    email,
    challengeId: challengeIdOf(request),
    sessionId: null,
  };
}

/** `/api/v1/auth/x` and `/auth/x` both reduce to `/auth/x`. */
function pathOf(request: Request): string {
  const raw = request.path;

  return raw.startsWith('/api/v1') ? raw.slice('/api/v1'.length) || '/' : raw;
}

function challengeIdOf(request: Request): string | null {
  const match = /^\/auth\/mfa\/challenges\/([^/]+)\/verification\/?$/.exec(
    pathOf(request),
  );

  return match?.[1] ?? null;
}
