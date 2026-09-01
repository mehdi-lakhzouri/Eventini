export interface EventSessionSchedule {
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly checkInOpensAt: Date | null;
  readonly checkInClosesAt: Date | null;
}

export function isValidEventSessionSchedule(
  schedule: EventSessionSchedule,
): boolean {
  if (schedule.startsAt.getTime() >= schedule.endsAt.getTime()) {
    return false;
  }

  return (
    schedule.checkInOpensAt === null ||
    schedule.checkInClosesAt === null ||
    schedule.checkInOpensAt.getTime() < schedule.checkInClosesAt.getTime()
  );
}
