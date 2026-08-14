/**
 * Parses a byte size into bytes.
 *
 * Same reasoning as the duration parser: `BODY_LIMIT_IMPORT=10mb` is auditable
 * at a glance, `10485760` is not — and a body limit is a denial-of-service
 * control (`RATE_LIMITING_AND_ABUSE_PREVENTION.md` §8.1), so it needs to be
 * readable by whoever reviews the deployment.
 *
 * Uses binary multiples (1 kb = 1024 bytes), matching Express's `body-parser`,
 * which is what ultimately consumes these values.
 */

const UNIT_TO_BYTES = {
  b: 1,
  kb: 1024,
  mb: 1024 * 1024,
  gb: 1024 * 1024 * 1024,
} as const;

type SizeUnit = keyof typeof UNIT_TO_BYTES;

const SIZE_PATTERN = /^(\d+)(b|kb|mb|gb)$/i;

export class SizeParseError extends Error {
  constructor(raw: string) {
    super(
      `Invalid size "${raw}". Expected a positive integer followed by b, kb, mb or gb (for example 100kb, 10mb).`,
    );
    this.name = 'SizeParseError';
  }
}

export function parseSize(raw: string): number {
  const match = SIZE_PATTERN.exec(raw.trim().toLowerCase());

  if (match === null) {
    throw new SizeParseError(raw);
  }

  const [, amountText, unitText] = match;

  if (amountText === undefined || unitText === undefined) {
    throw new SizeParseError(raw);
  }

  const amount = Number(amountText);

  if (amount <= 0) {
    throw new SizeParseError(raw);
  }

  return amount * UNIT_TO_BYTES[unitText as SizeUnit];
}
