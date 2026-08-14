import type { EventStatus } from '../../../infrastructure/database/enums';

/**
 * The event lifecycle — DATABASE_SCHEMA.md §6.1 and product context §8.2.
 *
 * ```
 *   DRAFT ──► ACTIVE ──► EXPIRED
 *     │         │
 *     └────►────┴──► CANCELLED
 * ```
 *
 * Nothing returns from `EXPIRED` or `CANCELLED`. That is the point rather
 * than an omission: tickets, attendance records and reports are all derived
 * from an event having reached a terminal state, so reopening one would leave
 * those artefacts describing a state the event no longer has. A cancelled
 * event that must run again is a new event.
 *
 * Declared as data rather than a chain of `if`s so it can be asserted
 * exhaustively — every pair of statuses is either listed or rejected, with no
 * third possibility.
 */
export const ALLOWED_EVENT_TRANSITIONS: Readonly<
  Record<EventStatus, readonly EventStatus[]>
> = {
  DRAFT: ['ACTIVE', 'CANCELLED'],
  ACTIVE: ['EXPIRED', 'CANCELLED'],
  EXPIRED: [],
  CANCELLED: [],
};

export function isTerminalEventStatus(status: EventStatus): boolean {
  return ALLOWED_EVENT_TRANSITIONS[status].length === 0;
}

export function canTransitionEvent(
  from: EventStatus,
  to: EventStatus,
): boolean {
  return ALLOWED_EVENT_TRANSITIONS[from].includes(to);
}

export interface EventActivationContext {
  /** How many non-deleted sessions the event has. */
  readonly sessionCount: number;
}

export type TransitionRefusal =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

/**
 * Decides whether an event may move from one status to another.
 *
 * `DRAFT → ACTIVE` additionally requires at least one session (§6.1, and the
 * EVT-015 ticket). An active event with no sessions is not a lesser event, it
 * is a broken one: check-in resolves against sessions, so every scan would
 * fail at the door with nothing in the data to explain why.
 *
 * Returns a reason rather than a boolean so the caller can put it in the RFC
 * 9457 `detail`; a bare `false` forces every call site to reinvent the
 * message, and they diverge.
 */
export function checkEventTransition(
  from: EventStatus,
  to: EventStatus,
  context: EventActivationContext,
): TransitionRefusal {
  if (from === to) {
    return { allowed: false, reason: `Event is already ${from}.` };
  }

  if (!canTransitionEvent(from, to)) {
    return isTerminalEventStatus(from)
      ? {
          allowed: false,
          reason: `${from} is terminal; an event cannot leave it.`,
        }
      : {
          allowed: false,
          reason: `Cannot move an event from ${from} to ${to}.`,
        };
  }

  if (to === 'ACTIVE' && context.sessionCount < 1) {
    return {
      allowed: false,
      reason:
        'An event needs at least one session before it can be activated; check-in resolves against sessions.',
    };
  }

  return { allowed: true };
}
