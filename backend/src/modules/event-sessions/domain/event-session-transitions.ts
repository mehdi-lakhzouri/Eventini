import type { EventSessionStatus } from '../../../infrastructure/database/enums';

export const ALLOWED_EVENT_SESSION_TRANSITIONS: Readonly<
  Record<EventSessionStatus, readonly EventSessionStatus[]>
> = {
  SCHEDULED: ['OPEN'],
  OPEN: ['CLOSED'],
  CLOSED: [],
};

export function canTransitionEventSession(
  from: EventSessionStatus,
  to: EventSessionStatus,
): boolean {
  return ALLOWED_EVENT_SESSION_TRANSITIONS[from].includes(to);
}
