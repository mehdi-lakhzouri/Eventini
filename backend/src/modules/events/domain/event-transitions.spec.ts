import { EVENT_STATUSES } from '../../../infrastructure/database/enums';
import {
  ALLOWED_EVENT_TRANSITIONS,
  canTransitionEvent,
  checkEventTransition,
  isTerminalEventStatus,
} from './event-transitions';

const withSessions = { sessionCount: 3 };
const withoutSessions = { sessionCount: 0 };

describe('ALLOWED_EVENT_TRANSITIONS', () => {
  it('covers every declared status, so no status is unreachable by omission', () => {
    expect(Object.keys(ALLOWED_EVENT_TRANSITIONS).sort()).toEqual(
      [...EVENT_STATUSES].sort(),
    );
  });

  it('only ever targets a declared status', () => {
    for (const targets of Object.values(ALLOWED_EVENT_TRANSITIONS)) {
      for (const target of targets) {
        expect(EVENT_STATUSES).toContain(target);
      }
    }
  });
});

describe('canTransitionEvent', () => {
  it.each([
    ['DRAFT', 'ACTIVE'],
    ['DRAFT', 'CANCELLED'],
    ['ACTIVE', 'EXPIRED'],
    ['ACTIVE', 'CANCELLED'],
  ] as const)('allows %s → %s', (from, to) => {
    expect(canTransitionEvent(from, to)).toBe(true);
  });

  /**
   * Nothing returns from a terminal state. Tickets, attendance records and
   * reports are all derived from an event having ended or been cancelled, so
   * reopening one leaves those artefacts describing a state the event no
   * longer has.
   */
  it.each([
    ['EXPIRED', 'ACTIVE'],
    ['EXPIRED', 'DRAFT'],
    ['CANCELLED', 'ACTIVE'],
    ['CANCELLED', 'DRAFT'],
    ['ACTIVE', 'DRAFT'],
    ['EXPIRED', 'CANCELLED'],
  ] as const)('refuses %s → %s', (from, to) => {
    expect(canTransitionEvent(from, to)).toBe(false);
  });
});

describe('isTerminalEventStatus', () => {
  it.each(['EXPIRED', 'CANCELLED'] as const)('%s is terminal', (status) => {
    expect(isTerminalEventStatus(status)).toBe(true);
  });

  it.each(['DRAFT', 'ACTIVE'] as const)('%s is not terminal', (status) => {
    expect(isTerminalEventStatus(status)).toBe(false);
  });
});

describe('checkEventTransition', () => {
  it('allows DRAFT → ACTIVE when the event has sessions', () => {
    expect(checkEventTransition('DRAFT', 'ACTIVE', withSessions)).toEqual({
      allowed: true,
    });
  });

  /**
   * §6.1 and the EVT-015 ticket. An active event with no sessions is not a
   * lesser event but a broken one: check-in resolves against sessions, so
   * every scan fails at the door with nothing in the data to explain why.
   */
  it('refuses DRAFT → ACTIVE when the event has no session', () => {
    const result = checkEventTransition('DRAFT', 'ACTIVE', withoutSessions);

    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toMatch(
      /at least one session/,
    );
  });

  it('does not require sessions to cancel a draft', () => {
    expect(checkEventTransition('DRAFT', 'CANCELLED', withoutSessions)).toEqual(
      { allowed: true },
    );
  });

  it('refuses a no-op transition, which is almost always a bug in the caller', () => {
    const result = checkEventTransition('ACTIVE', 'ACTIVE', withSessions);

    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toMatch(/already ACTIVE/);
  });

  it('says a terminal state is terminal, rather than just refusing', () => {
    const result = checkEventTransition('CANCELLED', 'ACTIVE', withSessions);

    expect(result.allowed).toBe(false);
    expect(result.allowed === false && result.reason).toMatch(/terminal/);
  });

  it('gives a usable reason for every refusal, so callers need not invent one', () => {
    for (const from of EVENT_STATUSES) {
      for (const to of EVENT_STATUSES) {
        const result = checkEventTransition(from, to, withoutSessions);

        if (!result.allowed) {
          expect(result.reason.length).toBeGreaterThan(10);
        }
      }
    }
  });
});
