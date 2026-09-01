import { EVENT_SESSION_STATUSES } from '../../../infrastructure/database/enums';
import { canTransitionEventSession } from './event-session-transitions';

describe('event session transitions', () => {
  it.each([
    ['SCHEDULED', 'OPEN'],
    ['OPEN', 'CLOSED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(canTransitionEventSession(from, to)).toBe(true);
  });

  it('rejects every transition not in the lifecycle', () => {
    for (const from of EVENT_SESSION_STATUSES) {
      for (const to of EVENT_SESSION_STATUSES) {
        const allowed =
          (from === 'SCHEDULED' && to === 'OPEN') ||
          (from === 'OPEN' && to === 'CLOSED');
        expect(canTransitionEventSession(from, to)).toBe(allowed);
      }
    }
  });
});
