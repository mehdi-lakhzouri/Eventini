import { isValidEventSchedule } from './event-schedule';

const at = (hour: number) =>
  new Date(`2026-09-10T${String(hour).padStart(2, '0')}:00:00Z`);

describe('event schedule', () => {
  it('accepts an ordered event and check-in window', () => {
    expect(
      isValidEventSchedule({
        startsAt: at(9),
        endsAt: at(18),
        checkInOpensAt: at(8),
        checkInClosesAt: at(17),
      }),
    ).toBe(true);
  });

  it('rejects an event whose end is not after its start', () => {
    expect(
      isValidEventSchedule({
        startsAt: at(18),
        endsAt: at(9),
        checkInOpensAt: null,
        checkInClosesAt: null,
      }),
    ).toBe(false);
  });

  it('rejects a reversed check-in window', () => {
    expect(
      isValidEventSchedule({
        startsAt: at(9),
        endsAt: at(18),
        checkInOpensAt: at(17),
        checkInClosesAt: at(8),
      }),
    ).toBe(false);
  });

  it('allows either check-in boundary to follow the event default', () => {
    expect(
      isValidEventSchedule({
        startsAt: at(9),
        endsAt: at(18),
        checkInOpensAt: at(8),
        checkInClosesAt: null,
      }),
    ).toBe(true);
  });
});
