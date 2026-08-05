import {
  failsClosed,
  rulesFor,
  type PolicySettings,
  type RequestFacts,
} from './rate-limit.policy';

const SETTINGS: PolicySettings = {
  globalPerIp: 300,
  globalPerUnauthenticatedIp: 60,
  loginPerIpAndEmail: 5,
  loginWindowMs: 900_000,
  loginPerIp: 20,
  mfaVerify: 5,
  refresh: 30,
  passwordResetPerEmail: 3,
};

function facts(overrides: Partial<RequestFacts> = {}): RequestFacts {
  return {
    method: 'GET',
    path: '/events',
    ip: '198.51.100.7',
    authenticated: true,
    email: null,
    challengeId: null,
    sessionId: null,
    ...overrides,
  };
}

const keysOf = (given: RequestFacts) =>
  rulesFor(given, SETTINGS).map((rule) => rule.key);

describe('rulesFor', () => {
  it('always applies the global IP window', () => {
    expect(keysOf(facts())).toEqual([expect.stringContaining('rl:global_ip:')]);
  });

  it('applies the stricter ceiling to an unauthenticated caller', () => {
    const [authenticated] = rulesFor(facts({ authenticated: true }), SETTINGS);
    const [anonymous] = rulesFor(facts({ authenticated: false }), SETTINGS);

    expect(authenticated?.limit).toBe(300);
    expect(anonymous?.limit).toBe(60);
  });

  describe('login', () => {
    const login = (email: string | null) =>
      facts({ method: 'POST', path: '/auth/sessions', email });

    /**
     * §2: a request crosses every applicable layer. A login inside its
     * per-email budget can still be exhausting the infrastructure budget, so
     * returning only the endpoint rule would let that pass unseen.
     */
    it('layers the global, per-IP and per-IP-and-email windows', () => {
      expect(keysOf(login('ada@example.com'))).toEqual([
        expect.stringContaining('rl:global_ip:'),
        expect.stringContaining('rl:login_ip:'),
        expect.stringContaining('rl:login_ip_email:'),
      ]);
    });

    it('carries the documented ceilings', () => {
      const rules = rulesFor(login('ada@example.com'), SETTINGS);

      expect(rules[1]).toMatchObject({ limit: 20, windowMs: 900_000 });
      expect(rules[2]).toMatchObject({ limit: 5, windowMs: 900_000 });
    });

    /**
     * 🔴 The key is ip+email. Two accounts behind one NAT — an event venue,
     * which §1 says is the normal case — must not share a counter.
     */
    it('gives two accounts on one IP different keys', () => {
      const [, , ada] = rulesFor(login('ada@example.com'), SETTINGS);
      const [, , grace] = rulesFor(login('grace@example.com'), SETTINGS);

      expect(ada?.key).not.toBe(grace?.key);
    });

    it('gives one account on two IPs different keys', () => {
      const here = rulesFor(login('ada@example.com'), SETTINGS)[2];
      const there = rulesFor(
        { ...login('ada@example.com'), ip: '203.0.113.9' },
        SETTINGS,
      )[2];

      expect(here?.key).not.toBe(there?.key);
    });

    it('never puts the address in the key in the clear', () => {
      const [, , perEmail] = rulesFor(login('ada@example.com'), SETTINGS);

      expect(perEmail?.key).not.toContain('ada@example.com');
      expect(perEmail?.key).not.toContain('ada');
    });

    /** Falling back to an IP-only key would merge unrelated accounts. */
    it('adds no per-email window when the body carried no address', () => {
      expect(keysOf(login(null))).toEqual([
        expect.stringContaining('rl:global_ip:'),
        expect.stringContaining('rl:login_ip:'),
      ]);
    });
  });

  it('limits MFA verification per challenge', () => {
    const rules = rulesFor(
      facts({
        method: 'POST',
        path: '/auth/mfa/challenges/mch_1/verification',
        challengeId: 'mch_1',
      }),
      SETTINGS,
    );

    expect(rules[1]).toMatchObject({ limit: 5, windowMs: 300_000 });
  });

  it('limits rotation per session', () => {
    const rules = rulesFor(
      facts({
        method: 'POST',
        path: '/auth/sessions/current/rotation',
        sessionId: 'ses_1',
      }),
      SETTINGS,
    );

    expect(rules[1]).toMatchObject({ limit: 30, windowMs: 3_600_000 });
  });

  it('limits password reset requests by IP and by address', () => {
    expect(
      keysOf(
        facts({
          method: 'POST',
          path: '/auth/password-reset-requests',
          email: 'ada@example.com',
        }),
      ),
    ).toEqual([
      expect.stringContaining('rl:global_ip:'),
      expect.stringContaining('rl:pwd_reset_ip:'),
      expect.stringContaining('rl:pwd_reset_email:'),
    ]);
  });

  it('ignores a trailing slash when matching a route', () => {
    expect(
      keysOf(
        facts({ method: 'POST', path: '/auth/sessions/', email: 'a@b.test' }),
      ),
    ).toHaveLength(3);
  });
});

describe('failsClosed', () => {
  it.each([
    ['/auth/sessions'],
    ['/auth/mfa/challenges/x/verification'],
    ['/auth/password-resets'],
    ['/auth/invitation-acceptances'],
  ])('refuses %s when the limiter is blind', (path) => {
    expect(failsClosed(facts({ path }))).toBe(true);
  });

  /**
   * An event in progress keeps working when Redis is down. Failing closed
   * everywhere would turn a limiter outage into a total outage, which §7.4
   * explicitly rejects.
   */
  it.each([['/events/evt_1/check-ins'], ['/organizations'], ['/auth/me']])(
    'lets %s through',
    (path) => {
      expect(failsClosed(facts({ path }))).toBe(false);
    },
  );
});
