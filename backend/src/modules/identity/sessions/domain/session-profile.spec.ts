import { deadlinesFor, profileFor } from './session-profile';

const LIFETIMES = {
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
};

const NOW = new Date('2026-08-01T12:00:00.000Z');

describe('profileFor', () => {
  it.each([
    ['WEB' as const, false, 'webAdmin'],
    ['WEB' as const, true, 'webSuperAdmin'],
    ['MOBILE_SCANNER' as const, false, 'scanner'],
    ['MOBILE_SCANNER' as const, true, 'scanner'],
  ])('maps %s / platform=%s to %s', (clientType, isAdmin, expected) => {
    expect(profileFor(clientType, isAdmin)).toBe(expected);
  });
});

describe('deadlinesFor', () => {
  it('offsets each deadline from the given instant', () => {
    expect(deadlinesFor('webAdmin', LIFETIMES, NOW)).toEqual({
      idleExpiresAt: new Date('2026-08-02T00:00:00.000Z'),
      absoluteExpiresAt: new Date('2026-08-31T12:00:00.000Z'),
      refreshExpiresAt: new Date('2026-08-15T12:00:00.000Z'),
    });
  });

  /** `ck_sessions_expiry_order` refuses the row if this ever inverts. */
  it.each(['webAdmin', 'webSuperAdmin', 'scanner'] as const)(
    'keeps the idle deadline at or before the absolute one for %s',
    (profile) => {
      const { idleExpiresAt, absoluteExpiresAt } = deadlinesFor(
        profile,
        LIFETIMES,
        NOW,
      );

      expect(idleExpiresAt.getTime()).toBeLessThanOrEqual(
        absoluteExpiresAt.getTime(),
      );
    },
  );

  it('gives the platform admin the tightest window', () => {
    const admin = deadlinesFor('webSuperAdmin', LIFETIMES, NOW);
    const ordinary = deadlinesFor('webAdmin', LIFETIMES, NOW);

    expect(admin.idleExpiresAt.getTime()).toBeLessThan(
      ordinary.idleExpiresAt.getTime(),
    );
    expect(admin.absoluteExpiresAt.getTime()).toBeLessThan(
      ordinary.absoluteExpiresAt.getTime(),
    );
  });
});
