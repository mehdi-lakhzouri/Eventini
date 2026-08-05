export interface SessionDeadlineState {
  readonly status: string;
  readonly idleExpiresAt: Date;
  readonly absoluteExpiresAt: Date;
}

export type SessionUnusable =
  'NOT_ACTIVE' | 'IDLE_EXPIRED' | 'ABSOLUTE_EXPIRED';

/**
 * Why a session cannot be continued, or `null` if it can.
 *
 * The two deadlines answer different questions and both are checked: the idle
 * one asks "has this session been used lately", the absolute one asks "has it
 * existed too long". A rotation pushes the first forward and never the
 * second, so a session that keeps refreshing still dies on schedule.
 */
export function sessionUnusableReason(
  session: SessionDeadlineState,
  now: Date,
): SessionUnusable | null {
  if (session.status !== 'ACTIVE') {
    return 'NOT_ACTIVE';
  }

  if (session.absoluteExpiresAt.getTime() <= now.getTime()) {
    return 'ABSOLUTE_EXPIRED';
  }

  if (session.idleExpiresAt.getTime() <= now.getTime()) {
    return 'IDLE_EXPIRED';
  }

  return null;
}
