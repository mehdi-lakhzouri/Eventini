import { isTenantContext } from '../../../common/types/tenant-context';
import type { Caller } from '../authentication/infrastructure/caller.resolver';
import { TenantContextService } from './tenant-context.service';

function caller(overrides: Partial<Caller> = {}): Caller {
  return {
    userId: 'usr_1',
    sessionId: 'ses_1',
    organizationId: 'org_1',
    membershipId: 'mbr_1',
    clientType: 'WEB',
    authenticationLevel: 'PASSWORD',
    ...overrides,
  };
}

describe('TenantContextService', () => {
  const service = new TenantContextService();

  it('builds a tenant context from a scoped session', () => {
    const context = service.fromCaller(caller());

    expect(context).toEqual({
      organizationId: 'org_1',
      membershipId: 'mbr_1',
      userId: 'usr_1',
      sessionId: 'ses_1',
      authLevel: 'PASSWORD',
    });
    expect(isTenantContext(context)).toBe(true);
  });

  /**
   * A platform session gets a different type rather than a `TenantContext`
   * with nulls — the call site that forgets `if (ctx.organizationId)` is the
   * one that leaks.
   */
  it.each([
    ['no organization', { organizationId: null }],
    ['no membership', { membershipId: null }],
  ])('returns a platform context for a session with %s', (_label, given) => {
    const context = service.fromCaller(caller(given));

    expect(isTenantContext(context)).toBe(false);
    expect(context).not.toHaveProperty('organizationId');
  });

  it('carries the authentication level through unchanged', () => {
    expect(
      service.fromCaller(caller({ authenticationLevel: 'REAUTHENTICATED' })),
    ).toMatchObject({ authLevel: 'REAUTHENTICATED' });
  });
});
