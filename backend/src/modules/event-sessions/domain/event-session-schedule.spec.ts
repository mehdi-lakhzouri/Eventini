import { isValidEventSessionSchedule } from './event-session-schedule';

const at = (iso: string) => new Date(iso);

describe('isValidEventSessionSchedule', () => {
  it('accepts an ordered session and check-in window', () => {
    expect(
      isValidEventSessionSchedule({
        startsAt: at('2027-04-08T09:00:00Z'),
        endsAt: at('2027-04-08T11:00:00Z'),
        checkInOpensAt: at('2027-04-08T08:30:00Z'),
        checkInClosesAt: at('2027-04-08T10:00:00Z'),
      }),
    ).toBe(true);
  });

  it('rejects reversed session and check-in windows', () => {
    expect(
      isValidEventSessionSchedule({
        startsAt: at('2027-04-08T11:00:00Z'),
        endsAt: at('2027-04-08T09:00:00Z'),
        checkInOpensAt: null,
        checkInClosesAt: null,
      }),
    ).toBe(false);
    expect(
      isValidEventSessionSchedule({
        startsAt: at('2027-04-08T09:00:00Z'),
        endsAt: at('2027-04-08T11:00:00Z'),
        checkInOpensAt: at('2027-04-08T10:00:00Z'),
        checkInClosesAt: at('2027-04-08T08:30:00Z'),
      }),
    ).toBe(false);
  });
});
