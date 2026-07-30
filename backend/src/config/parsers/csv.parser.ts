/**
 * Parses a comma-separated list.
 *
 * Used by `CORS_ALLOWED_ORIGINS`, `LOCKOUT_THRESHOLDS` and `LOCKOUT_DURATIONS`.
 *
 * Empty entries are dropped rather than preserved as empty strings. A trailing
 * comma in `CORS_ALLOWED_ORIGINS` would otherwise produce an `""` entry, and an
 * empty allowed origin compared by strict equality against a missing `Origin`
 * header is exactly the kind of accident that turns a deny into an allow.
 */
export function parseCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

export class CsvIntegerParseError extends Error {
  constructor(raw: string, offending: string) {
    super(
      `Invalid integer list "${raw}": "${offending}" is not a positive integer.`,
    );
    this.name = 'CsvIntegerParseError';
  }
}

/** Parses a comma-separated list of positive integers, such as `5,10,15`. */
export function parseCsvIntegers(raw: string): number[] {
  return parseCsv(raw).map((entry) => {
    if (!/^\d+$/.test(entry)) {
      throw new CsvIntegerParseError(raw, entry);
    }

    const value = Number(entry);

    if (value <= 0) {
      throw new CsvIntegerParseError(raw, entry);
    }

    return value;
  });
}
