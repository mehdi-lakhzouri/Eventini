import type { ExecutionContext } from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import type { Request } from 'express';

import { AppException } from '../../../common/api/app-exception';
import type { csrfConfig } from '../../../config/csrf.config';
import { CsrfGuard } from './csrf.guard';
import type { CsrfService } from './csrf.service';
import type { OriginValidatorService } from './origin-validator.service';

const CONFIG = {
  headerName: 'X-CSRF-Token',
  protectedMethods: ['POST', 'PUT', 'PATCH', 'DELETE'],
  exemptPaths: ['/health/live', '/health/ready', '/health/startup', '/metrics'],
} as unknown as ConfigType<typeof csrfConfig>;

function contextFor(request: Partial<Request>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function guard(options: { originAllowed?: boolean; tokenValid?: boolean } = {}) {
  const csrf = {
    validate: jest.fn(() => options.tokenValid ?? true),
  } as unknown as CsrfService;
  const origins = {
    isAllowed: jest.fn(() => options.originAllowed ?? true),
  } as unknown as OriginValidatorService;

  return { guard: new CsrfGuard(csrf, origins, CONFIG), csrf, origins };
}

function request(overrides: Partial<Request> = {}): Partial<Request> {
  return {
    method: 'POST',
    path: '/api/v1/auth/sessions',
    headers: { cookie: 'x=1' },
    ...overrides,
  };
}

describe('CsrfGuard', () => {
  it('lets a valid mutation through', () => {
    const { guard: subject } = guard();

    expect(subject.canActivate(contextFor(request()))).toBe(true);
  });

  it.each([['GET'], ['HEAD'], ['OPTIONS']])(
    'does not challenge %s',
    (method) => {
      const { guard: subject, origins } = guard({ originAllowed: false });

      expect(subject.canActivate(contextFor(request({ method })))).toBe(true);
      expect(origins.isAllowed).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['/api/v1/health/live'],
    ['/api/v1/metrics'],
    ['/metrics'],
    ['/api/v1/metrics/'],
  ])('exempts %s', (path) => {
    const { guard: subject } = guard({ originAllowed: false });

    expect(subject.canActivate(contextFor(request({ path })))).toBe(true);
  });

  /** `endsWith` matching would have exempted this one. */
  it('does not exempt a route that merely ends in an exempt path', () => {
    const { guard: subject } = guard({ originAllowed: false });

    expect(() =>
      subject.canActivate(
        contextFor(request({ path: '/api/v1/organizations/metrics' })),
      ),
    ).toThrow(AppException);
  });

  it('exempts a Bearer request carrying no cookie', () => {
    const { guard: subject } = guard({ originAllowed: false });

    expect(
      subject.canActivate(
        contextFor(request({ headers: { authorization: 'Bearer token' } })),
      ),
    ).toBe(true);
  });

  /** A cookie makes the request replayable cross-site whatever else it carries. */
  it('protects a Bearer request that also sends a cookie', () => {
    const { guard: subject } = guard({ tokenValid: false });

    expect(() =>
      subject.canActivate(
        contextFor(
          request({
            headers: { authorization: 'Bearer token', cookie: 'a=1' },
          }),
        ),
      ),
    ).toThrow(expect.objectContaining({ code: 'AUTH_CSRF_INVALID' }));
  });

  it('refuses a denied origin before looking at the token', () => {
    const { guard: subject, csrf } = guard({ originAllowed: false });

    expect(() => subject.canActivate(contextFor(request()))).toThrow(
      expect.objectContaining({ code: 'AUTH_ORIGIN_DENIED' }),
    );
    expect(csrf.validate).not.toHaveBeenCalled();
  });

  it('refuses an invalid token', () => {
    const { guard: subject } = guard({ tokenValid: false });

    expect(() => subject.canActivate(contextFor(request()))).toThrow(
      expect.objectContaining({ code: 'AUTH_CSRF_INVALID' }),
    );
  });
});
