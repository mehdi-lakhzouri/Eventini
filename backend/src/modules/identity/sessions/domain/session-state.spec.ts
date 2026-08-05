import { sessionUnusableReason } from './session-state';

const NOW = new Date('2026-08-01T12:00:00.000Z');
const LATER = new Date('2026-08-01T13:00:00.000Z');
const EARLIER = new Date('2026-08-01T11:00:00.000Z');

function session(
  overrides: Partial<Parameters<typeof sessionUnusableReason>[0]> = {},
) {
  return {
    status: 'ACTIVE',
    idleExpiresAt: LATER,
    absoluteExpiresAt: LATER,
    ...overrides,
  };
}

describe('sessionUnusableReason', () => {
  it('accepts a live session', () => {
    expect(sessionUnusableReason(session(), NOW)).toBeNull();
  });

  it.each(['REVOKED', 'EXPIRED', 'COMPROMISED', 'REPLACED'])(
    'refuses a %s session',
    (status) => {
      expect(sessionUnusableReason(session({ status }), NOW)).toBe(
        'NOT_ACTIVE',
      );
    },
  );

  it('refuses one past its idle deadline', () => {
    expect(
      sessionUnusableReason(session({ idleExpiresAt: EARLIER }), NOW),
    ).toBe('IDLE_EXPIRED');
  });

  it('refuses one past its absolute deadline', () => {
    expect(
      sessionUnusableReason(
        session({ idleExpiresAt: EARLIER, absoluteExpiresAt: EARLIER }),
        NOW,
      ),
    ).toBe('ABSOLUTE_EXPIRED');
  });

  /**
   * The absolute deadline is checked first because it is the one a rotation
   * cannot move. A session refreshing continuously keeps its idle deadline in
   * the future forever, so reporting the idle one would name the wrong bound.
   */
  it('reports the absolute deadline when both have passed', () => {
    expect(
      sessionUnusableReason(
        session({ idleExpiresAt: EARLIER, absoluteExpiresAt: EARLIER }),
        NOW,
      ),
    ).toBe('ABSOLUTE_EXPIRED');
  });

  it('refuses a session expiring exactly now', () => {
    expect(
      sessionUnusableReason(
        session({ idleExpiresAt: NOW, absoluteExpiresAt: LATER }),
        NOW,
      ),
    ).toBe('IDLE_EXPIRED');
  });

  /** Status is checked before either deadline: revoked is revoked. */
  it('reports revocation over expiry', () => {
    expect(
      sessionUnusableReason(
        session({
          status: 'REVOKED',
          idleExpiresAt: EARLIER,
          absoluteExpiresAt: EARLIER,
        }),
        NOW,
      ),
    ).toBe('NOT_ACTIVE');
  });
});
