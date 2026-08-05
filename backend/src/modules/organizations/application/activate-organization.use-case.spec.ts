import type { SessionIssuer } from '../../identity/authentication/application/session-issuer';
import type {
  AuthenticationCandidate,
  AuthenticationRepository,
} from '../../identity/authentication/domain/authentication.repository';
import type {
  ActivationRefusal,
  ActivationTarget,
  OrganizationRepository,
} from '../domain/organization.repository';
import {
  ActivateOrganizationUseCase,
  type ActivateOrganizationCommand,
} from './activate-organization.use-case';

const CANDIDATE: AuthenticationCandidate = {
  userId: 'usr_1',
  status: 'ACTIVE',
  userVersion: 7,
  passwordHash: 'irrelevant',
  passwordVersion: 1,
  hasActiveMfa: false,
  hasPlatformRole: false,
  isSuperAdmin: false,
  memberships: [],
};

function command(
  overrides: Partial<ActivateOrganizationCommand> = {},
): ActivateOrganizationCommand {
  return {
    userId: 'usr_1',
    currentSessionId: 'ses_old',
    organizationId: 'org_target',
    clientType: 'WEB',
    authenticationLevel: 'PASSWORD',
    userAgent: 'jest',
    ipAddress: '127.0.0.1',
    requestId: 'req_1',
    ...overrides,
  };
}

function build(options: {
  target?: ActivationTarget | ActivationRefusal;
  candidate?: AuthenticationCandidate | null;
}) {
  const lookups: { userId: string; organizationId: string }[] = [];
  const issued: Record<string, unknown>[] = [];

  const organizations = {
    findActivationTarget: (userId: string, organizationId: string) => {
      lookups.push({ userId, organizationId });

      return Promise.resolve(
        options.target ?? {
          organizationId: 'org_target',
          membershipId: 'mbr_target',
        },
      );
    },
  } as unknown as OrganizationRepository;

  const users = {
    findCandidateById: () =>
      Promise.resolve(
        options.candidate === undefined ? CANDIDATE : options.candidate,
      ),
  } as unknown as AuthenticationRepository;

  const issuer = {
    issueResolved: (input: Record<string, unknown>) => {
      issued.push(input);

      return Promise.resolve({ sessionId: 'ses_new' });
    },
  } as unknown as SessionIssuer;

  return {
    useCase: new ActivateOrganizationUseCase(organizations, users, issuer),
    lookups,
    issued,
  };
}

describe('activateOrganization', () => {
  /**
   * 🔴 ADR-0002. The id from the path is only ever used to find a membership
   * belonging to *this* caller, so a forged one finds nothing rather than
   * scoping a query onto another tenant.
   */
  it('looks the target up against the caller, never on its own', async () => {
    const { useCase, lookups } = build({});

    await useCase.execute(command({ organizationId: 'org_someone_else' }));

    expect(lookups).toEqual([
      { userId: 'usr_1', organizationId: 'org_someone_else' },
    ]);
  });

  it('issues the session on the membership the lookup returned', async () => {
    const { useCase, issued } = build({});

    await useCase.execute(command());

    expect(issued[0]).toMatchObject({
      organizationId: 'org_target',
      membershipId: 'mbr_target',
    });
  });

  it('retires the current session in the same call', async () => {
    const { useCase, issued } = build({});

    await useCase.execute(command());

    expect(issued[0]).toMatchObject({ replacingSessionId: 'ses_old' });
  });

  /**
   * 🔴 Carried across in both directions.
   *
   * Hardcoding `MFA` would hand every switch an assurance level it never
   * earned — a privilege escalation through a route that only claims to change
   * organization. Hardcoding `PASSWORD` would drop a guarantee the session did
   * earn, and a later `@RequireAuthLevel` would refuse a caller who had in
   * fact verified.
   */
  it.each([['PASSWORD'], ['MFA'], ['REAUTHENTICATED']] as const)(
    'carries the %s level across the switch',
    async (level) => {
      const { useCase, issued } = build({});

      await useCase.execute(command({ authenticationLevel: level }));

      expect(issued[0]).toMatchObject({ authenticationLevel: level });
    },
  );

  it('re-reads the account rather than trusting the session', async () => {
    const { useCase, issued } = build({});

    await useCase.execute(command());

    // The version comes from the fresh read, not from anything the caller sent.
    expect(issued[0]).toMatchObject({ userVersion: 7 });
  });

  it.each([['NO_MEMBERSHIP'], ['ORGANIZATION_UNAVAILABLE']] as const)(
    'refuses on %s without issuing anything',
    async (refusal) => {
      const { useCase, issued } = build({ target: refusal });

      await expect(useCase.execute(command())).rejects.toMatchObject({
        refusal,
      });
      expect(issued).toEqual([]);
    },
  );

  it('refuses an account that is no longer active', async () => {
    const { useCase, issued } = build({
      candidate: { ...CANDIDATE, status: 'SUSPENDED' },
    });

    await expect(useCase.execute(command())).rejects.toThrow();
    expect(issued).toEqual([]);
  });

  it('refuses an account that has been deleted since the session was issued', async () => {
    const { useCase, issued } = build({ candidate: null });

    await expect(useCase.execute(command())).rejects.toThrow();
    expect(issued).toEqual([]);
  });
});
