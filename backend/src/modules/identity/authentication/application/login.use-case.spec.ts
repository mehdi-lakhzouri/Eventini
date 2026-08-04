import { generateKeyPairSync, randomBytes } from 'node:crypto';

import { TransactionManager } from '../../../../infrastructure/database/transaction.manager';
import { ArgonPasswordHasher } from '../../passwords/infrastructure/argon-password-hasher';
import type { SessionRepository } from '../../sessions/domain/session.repository';
import { AuthenticationError } from '../domain/authentication.errors';
import type {
  AuthenticationCandidate,
  AuthenticationRepository,
} from '../domain/authentication.repository';
import { AccessTokenSigner } from '../infrastructure/jwt/access-token.signer';
import { SigningKeySet } from '../infrastructure/jwt/signing-keys';
import { LoginUseCase, type LoginCommand } from './login.use-case';

const PASSWORD = 'correct horse battery staple';

// Cheapest parameters that still exercise the real Argon2id path: the timing
// assertion below compares two branches of the same implementation, so the
// absolute cost is irrelevant and a fast one keeps the suite usable.
const hasher = new ArgonPasswordHasher({
  memoryCost: 8192,
  timeCost: 1,
  parallelism: 1,
  hashLength: 32,
  pepper: randomBytes(32).toString('base64'),
});

const CONFIG = {
  lifetimes: {
    accessToken: { webAdmin: 600, webSuperAdmin: 300, scanner: 900 },
    sessionIdle: { webAdmin: 43_200, webSuperAdmin: 1800, scanner: 604_800 },
    sessionAbsolute: {
      webAdmin: 2_592_000,
      webSuperAdmin: 604_800,
      scanner: 7_776_000,
    },
    refreshToken: {
      webAdmin: 1_209_600,
      webSuperAdmin: 86_400,
      scanner: 2_592_000,
    },
  },
  refreshToken: { hmacSecret: randomBytes(32).toString('base64') },
};

function keyPair() {
  const pair = generateKeyPairSync('ed25519');

  return new SigningKeySet({
    privateKey: pair.privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    publicKey: pair.publicKey
      .export({ type: 'spki', format: 'pem' })
      .toString(),
    keyId: 'ak_test',
  });
}

const signer = new AccessTokenSigner(keyPair(), {
  issuer: 'https://api.eventini.test',
  audienceWeb: 'eventini-web',
  audienceScanner: 'eventini-scanner',
});

function command(overrides: Partial<LoginCommand> = {}): LoginCommand {
  return {
    email: 'Admin@Example.com',
    password: PASSWORD,
    clientType: 'WEB',
    userAgent: 'jest',
    ipAddress: '127.0.0.1',
    requestId: 'req_1',
    ...overrides,
  };
}

async function candidate(
  overrides: Partial<AuthenticationCandidate> = {},
): Promise<AuthenticationCandidate> {
  return {
    userId: 'usr_1',
    status: 'ACTIVE',
    userVersion: 4,
    passwordHash: await hasher.hash(PASSWORD),
    passwordVersion: 1,
    hasActiveMfa: false,
    hasPlatformRole: false,
    memberships: [
      {
        membershipId: 'mbr_1',
        organizationId: 'org_1',
        organizationActive: true,
        organizationEnabled: true,
      },
    ],
    ...overrides,
  };
}

function build(found: AuthenticationCandidate | null) {
  const lookups: string[] = [];
  const created: unknown[] = [];

  const users: AuthenticationRepository = {
    findCandidateByEmail: (email: string) => {
      lookups.push(email);

      return Promise.resolve(found);
    },
  };

  const sessions = {
    createWithRefreshToken: (
      _tx: unknown,
      session: unknown,
      refreshToken: unknown,
    ) => {
      created.push({ session, refreshToken });

      return Promise.resolve({
        sessionId: 'ses_1',
        tokenFamilyId: 'fam_1',
        refreshTokenId: 'rot_1',
      });
    },
    touchLastLogin: () => Promise.resolve(),
  } as unknown as SessionRepository;

  // Runs the callback directly: the transaction boundary is proven against
  // real PostgreSQL in the integration suite, not with a fake that would only
  // prove the fake commits.
  const transactions = {
    runInTransaction: <T>(work: (tx: unknown) => Promise<T>) => work({}),
  } as unknown as TransactionManager;

  const useCase = new LoginUseCase(
    users,
    sessions,
    hasher,
    signer,
    transactions,
    CONFIG as never,
  );

  return { useCase, lookups, created };
}

describe('login', () => {
  it('normalizes the email before looking it up', async () => {
    const { useCase, lookups } = build(await candidate());

    await useCase.execute(command({ email: '  ADMIN@Example.COM ' }));

    expect(lookups).toEqual(['admin@example.com']);
  });

  it('issues a session, an access token and a refresh token', async () => {
    const { useCase, created } = build(await candidate());

    const result = await useCase.execute(command());

    expect(result.sessionId).toBe('ses_1');
    expect(result.organizationId).toBe('org_1');
    expect(result.membershipId).toBe('mbr_1');
    expect(result.accessToken.split('.')).toHaveLength(3);
    expect(Buffer.from(result.refreshToken, 'base64url')).toHaveLength(32);
    expect(result.requiresOrganizationSelection).toBe(false);
    expect(created).toHaveLength(1);
  });

  it('stores the refresh token hashed, never in the clear', async () => {
    const { useCase, created } = build(await candidate());

    const result = await useCase.execute(command());
    const { refreshToken } = created[0] as {
      refreshToken: { tokenHash: string };
    };

    expect(refreshToken.tokenHash).not.toBe(result.refreshToken);
    expect(refreshToken.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('starts every session at PASSWORD, never at MFA', async () => {
    const { useCase, created } = build(await candidate({ hasActiveMfa: true }));

    await useCase.execute(command());
    const { session } = created[0] as {
      session: { authenticationLevel: string };
    };

    expect(session.authenticationLevel).toBe('PASSWORD');
  });

  describe('organization resolution', () => {
    it('leaves the session unscoped when several organizations are usable', async () => {
      const { useCase } = build(
        await candidate({
          memberships: [
            {
              membershipId: 'mbr_1',
              organizationId: 'org_1',
              organizationActive: true,
              organizationEnabled: true,
            },
            {
              membershipId: 'mbr_2',
              organizationId: 'org_2',
              organizationActive: true,
              organizationEnabled: true,
            },
          ],
        }),
      );

      const result = await useCase.execute(command());

      expect(result.organizationId).toBeNull();
      expect(result.membershipId).toBeNull();
      expect(result.requiresOrganizationSelection).toBe(true);
    });

    it('creates a platform session for a platform role with no membership', async () => {
      const { useCase } = build(
        await candidate({ memberships: [], hasPlatformRole: true }),
      );

      const result = await useCase.execute(command());

      expect(result.organizationId).toBeNull();
      expect(result.requiresOrganizationSelection).toBe(false);
    });

    it('refuses a user with neither membership nor platform role', async () => {
      const { useCase } = build(await candidate({ memberships: [] }));

      await expect(useCase.execute(command())).rejects.toMatchObject({
        rejection: 'NO_ACCESS',
      });
    });

    it('refuses generically when the only organization is suspended', async () => {
      const { useCase } = build(
        await candidate({
          memberships: [
            {
              membershipId: 'mbr_1',
              organizationId: 'org_1',
              organizationActive: false,
              organizationEnabled: true,
            },
          ],
        }),
      );

      await expect(useCase.execute(command())).rejects.toMatchObject({
        rejection: 'ORGANIZATION_UNAVAILABLE',
      });
    });
  });

  describe('refusals', () => {
    it.each([
      ['an unknown account', null, 'UNKNOWN_ACCOUNT'],
      ['a missing credential', { passwordHash: null }, 'NO_CREDENTIAL'],
      ['a suspended user', { status: 'SUSPENDED' }, 'USER_NOT_ACTIVE'],
      ['a locked user', { status: 'LOCKED' }, 'USER_NOT_ACTIVE'],
    ])('refuses %s', async (_label, overrides, rejection) => {
      const found = overrides === null ? null : await candidate(overrides);
      const { useCase } = build(found);

      await expect(useCase.execute(command())).rejects.toMatchObject({
        rejection,
      });
    });

    it('refuses a wrong password', async () => {
      const { useCase } = build(await candidate());

      await expect(
        useCase.execute(command({ password: 'not the password' })),
      ).rejects.toBeInstanceOf(AuthenticationError);
    });

    it('creates no session when it refuses', async () => {
      const { useCase, created } = build(await candidate());

      await expect(
        useCase.execute(command({ password: 'wrong' })),
      ).rejects.toThrow();

      expect(created).toEqual([]);
    });

    /**
     * Step 9 runs *after* the hash on purpose. Checking the status first would
     * make a suspended account answer without paying for Argon2id, which is
     * the same disclosure as skipping the hash for an unknown one.
     */
    it('still hashes for a suspended account', async () => {
      const { useCase } = build(await candidate({ status: 'SUSPENDED' }));

      const started = performance.now();
      await expect(useCase.execute(command())).rejects.toThrow();

      expect(performance.now() - started).toBeGreaterThan(1);
    });
  });

  /**
   * 🔴 Step 7, the reason it exists.
   *
   * Without the decoy the unknown-account path skips Argon2id entirely and
   * answers an order of magnitude faster, which is remotely measurable user
   * enumeration. The bound is deliberately loose: it catches "the work was
   * skipped", not scheduling jitter.
   */
  it('takes comparable time for an unknown account and a wrong password', async () => {
    const known = build(await candidate());
    const unknown = build(null);

    // Warm both paths so the decoy hash is already built.
    await known.useCase.execute(command({ password: 'wrong' })).catch(() => {});
    await unknown.useCase.execute(command()).catch(() => {});

    const time = async (run: () => Promise<unknown>): Promise<number> => {
      const started = performance.now();
      await run().catch(() => {});

      return performance.now() - started;
    };

    const wrongPassword = await time(() =>
      known.useCase.execute(command({ password: 'wrong' })),
    );
    const noAccount = await time(() => unknown.useCase.execute(command()));

    expect(noAccount).toBeGreaterThan(wrongPassword / 4);
    expect(noAccount).toBeLessThan(wrongPassword * 4);
  });
});
