/**
 * Parses a human duration into milliseconds.
 *
 * The catalogue in `docs/operations/ENVIRONMENT_VARIABLES.md` writes lifetimes
 * as `10m`, `14d`, `30s`. Storing those as raw millisecond integers in `.env`
 * would make the security posture unreadable: `1209600000` says nothing, `14d`
 * says everything.
 *
 * Deliberately strict — no bare numbers, no compound forms like `1h30m`, no
 * floats. A silently misparsed `SESSION_ABSOLUTE_TTL` is a security defect, so
 * anything ambiguous is rejected rather than guessed at.
 */

const UNIT_TO_MS = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
} as const;

type DurationUnit = keyof typeof UNIT_TO_MS;

const DURATION_PATTERN = /^(\d+)(s|m|h|d)$/;

export class DurationParseError extends Error {
  constructor(raw: string) {
    super(
      `Invalid duration "${raw}". Expected a positive integer followed by s, m, h or d (for example 30s, 10m, 12h, 14d).`,
    );
    this.name = 'DurationParseError';
  }
}

export function parseDuration(raw: string): number {
  const match = DURATION_PATTERN.exec(raw.trim());

  if (match === null) {
    throw new DurationParseError(raw);
  }

  const [, amountText, unitText] = match;

  // noUncheckedIndexedAccess: the regex guarantees both groups on a match, but
  // the compiler cannot know that. Guarding is cheaper than asserting.
  if (amountText === undefined || unitText === undefined) {
    throw new DurationParseError(raw);
  }

  const amount = Number(amountText);

  // `0m` is almost certainly a mistake — a zero-lifetime token or session is
  // never a deliberate configuration.
  if (amount <= 0) {
    throw new DurationParseError(raw);
  }

  return amount * UNIT_TO_MS[unitText as DurationUnit];
}

/** Formats milliseconds back into the shortest exact unit, for error messages. */
export function formatDuration(milliseconds: number): string {
  const units: readonly DurationUnit[] = ['d', 'h', 'm', 's'];

  for (const unit of units) {
    const size = UNIT_TO_MS[unit];
    if (milliseconds % size === 0 && milliseconds >= size) {
      return `${milliseconds / size}${unit}`;
    }
  }

  return `${milliseconds}ms`;
}
