import { Inject, Injectable, type CanActivate } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { AppException } from '../../../common/api/app-exception';
import { csrfConfig } from '../../../config/csrf.config';
import { CsrfService } from './csrf.service';
import { OriginValidatorService } from './origin-validator.service';

const VERSION_PREFIX = /^\/api\/v\d+/;

/**
 * Registered as an `APP_GUARD`, so protection is the default and exemption is
 * the exception that has to be written down. The reverse — opting routes in —
 * fails open: the route somebody forgets is the one that is unprotected, and
 * §3.4 is explicit that anything accepting an authentication cookie is
 * covered, without exception.
 *
 * Every refusal is the same `403`, with no indication of which step failed.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly csrf: CsrfService,
    private readonly origins: OriginValidatorService,
    @Inject(csrfConfig.KEY)
    private readonly config: ConfigType<typeof csrfConfig>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (!this.isProtected(request)) {
      return true;
    }

    if (!this.origins.isAllowed(request)) {
      throw new AppException('AUTH_ORIGIN_DENIED');
    }

    if (!this.csrf.validate(request)) {
      throw new AppException('AUTH_CSRF_INVALID');
    }

    return true;
  }

  private isProtected(request: Request): boolean {
    const methods: readonly string[] = this.config.protectedMethods;
    const exempt: readonly string[] = this.config.exemptPaths;

    return (
      methods.includes(request.method) &&
      !exempt.includes(routeOf(request)) &&
      !isBearerOnly(request)
    );
  }
}

/**
 * The version prefix is stripped so the exemption list stays written the way
 * the specification writes it, and matched whole — `endsWith` would exempt
 * `/api/v1/organizations/metrics` along with `/metrics`.
 */
function routeOf(request: Request): string {
  const path = request.path.replace(VERSION_PREFIX, '');

  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * §3.4's mobile exemption: a `Bearer` token is not sent automatically by a
 * browser, so it cannot be ridden cross-site. The "no cookie at all" half is
 * what makes that true — a request carrying both would be replayable through
 * the cookie and must stay protected.
 */
function isBearerOnly(request: Request): boolean {
  const authorization = request.headers.authorization;

  return (
    typeof authorization === 'string' &&
    authorization.startsWith('Bearer ') &&
    request.headers.cookie === undefined
  );
}
