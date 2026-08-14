import { accessTokenTtlSeconds } from './access-token.lifetime';

const LIFETIMES = { webAdmin: 600, webSuperAdmin: 300, scanner: 900 };

describe('accessTokenTtlSeconds', () => {
  it.each([
    ['a web admin', 'WEB' as const, false, 600],
    ['a platform admin on the web', 'WEB' as const, true, 300],
    ['a scanner', 'MOBILE_SCANNER' as const, false, 900],
  ])('gives %s %d seconds', (_label, clientType, isPlatformAdmin, expected) => {
    expect(accessTokenTtlSeconds(clientType, isPlatformAdmin, LIFETIMES)).toBe(
      expected,
    );
  });

  /** The scanner has to survive a venue with poor connectivity. */
  it('does not shorten a scanner token for a platform admin', () => {
    expect(accessTokenTtlSeconds('MOBILE_SCANNER', true, LIFETIMES)).toBe(900);
  });

  /** The most valuable token to steal gets the shortest window. */
  it('gives the platform admin the shortest web window', () => {
    expect(accessTokenTtlSeconds('WEB', true, LIFETIMES)).toBeLessThan(
      accessTokenTtlSeconds('WEB', false, LIFETIMES),
    );
  });
});
