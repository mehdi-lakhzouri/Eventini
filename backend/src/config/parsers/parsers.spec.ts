import {
  DurationParseError,
  formatDuration,
  parseDuration,
} from './duration.parser';
import { SizeParseError, parseSize } from './size.parser';
import { CsvIntegerParseError, parseCsv, parseCsvIntegers } from './csv.parser';
import {
  EXAMPLE_SECRET_MARKER,
  SecretParseError,
  decodeBase64Secret,
  isExampleSecret,
} from './secret.parser';

describe('parseDuration', () => {
  it.each([
    ['30s', 30_000],
    ['10m', 600_000],
    ['12h', 43_200_000],
    ['14d', 1_209_600_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('tolerates surrounding whitespace', () => {
    expect(parseDuration('  15m  ')).toBe(900_000);
  });

  // Rejections matter more than acceptances here: a silently misparsed session
  // lifetime is a security defect, not a formatting inconvenience.
  it.each([
    ['600000', 'a bare number could mean seconds or milliseconds'],
    ['1h30m', 'compound forms would parse ambiguously'],
    ['1.5h', 'fractions invite rounding surprises'],
    ['10y', 'unsupported unit'],
    ['-5m', 'negative duration'],
    ['0m', 'a zero-lifetime token is never deliberate'],
    ['', 'empty'],
    ['m', 'no amount'],
  ])('rejects %s (%s)', (input) => {
    expect(() => parseDuration(input)).toThrow(DurationParseError);
  });

  it('names the offending value in the error', () => {
    expect(() => parseDuration('nonsense')).toThrow(/nonsense/);
  });
});

describe('formatDuration', () => {
  it.each([
    [1_209_600_000, '14d'],
    [43_200_000, '12h'],
    [600_000, '10m'],
    [30_000, '30s'],
  ])('formats %d as %s', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });

  it('falls back to milliseconds when no unit divides exactly', () => {
    expect(formatDuration(1_500)).toBe('1500ms');
  });
});

describe('parseSize', () => {
  it.each([
    ['100kb', 102_400],
    ['10mb', 10_485_760],
    ['512b', 512],
    ['1gb', 1_073_741_824],
  ])('parses %s', (input, expected) => {
    expect(parseSize(input)).toBe(expected);
  });

  it('is case insensitive', () => {
    expect(parseSize('10MB')).toBe(10_485_760);
  });

  it.each([['100'], ['10tb'], ['0kb'], ['-1mb'], ['']])(
    'rejects %s',
    (input) => {
      expect(() => parseSize(input)).toThrow(SizeParseError);
    },
  );
});

describe('parseCsv', () => {
  it('splits and trims', () => {
    expect(parseCsv('a, b ,c')).toEqual(['a', 'b', 'c']);
  });

  // A trailing comma would otherwise yield an "" entry, and an empty allowed
  // origin compared by strict equality is how a deny quietly becomes an allow.
  it('drops empty entries produced by a trailing comma', () => {
    expect(parseCsv('https://a.com,https://b.com,')).toEqual([
      'https://a.com',
      'https://b.com',
    ]);
  });

  it('returns an empty array for an empty string', () => {
    expect(parseCsv('')).toEqual([]);
  });
});

describe('parseCsvIntegers', () => {
  it('parses a lockout ladder', () => {
    expect(parseCsvIntegers('5,10,15')).toEqual([5, 10, 15]);
  });

  it.each([['5,abc,15'], ['5,-1'], ['5,0'], ['5,1.5']])(
    'rejects %s',
    (input) => {
      expect(() => parseCsvIntegers(input)).toThrow(CsvIntegerParseError);
    },
  );
});

describe('decodeBase64Secret', () => {
  it('decodes valid base64', () => {
    const raw = Buffer.from('a'.repeat(32)).toString('base64');
    expect(decodeBase64Secret(raw)).toHaveLength(32);
  });

  // Buffer.from(x, 'base64') never throws — it silently drops invalid
  // characters, turning a typo into a shorter key. Re-encoding is what makes
  // that failure visible.
  it('rejects a value that is not valid base64', () => {
    expect(() => decodeBase64Secret('not!valid!base64!')).toThrow(
      SecretParseError,
    );
  });

  it('rejects an empty value', () => {
    expect(() => decodeBase64Secret('')).toThrow(SecretParseError);
  });
});

describe('isExampleSecret', () => {
  it('detects the .env.example placeholder', () => {
    const placeholder = Buffer.from(
      `${EXAMPLE_SECRET_MARKER}-REPLACE-BEFORE-ANY-DEPLOYMENT`,
    ).toString('base64');

    expect(isExampleSecret(placeholder)).toBe(true);
  });

  it('does not flag a real random secret', () => {
    const real = Buffer.from('x'.repeat(32)).toString('base64');
    expect(isExampleSecret(real)).toBe(false);
  });

  it('returns false rather than throwing on undecodable input', () => {
    // Rule 7 reports malformed secrets; this check must not mask it.
    expect(isExampleSecret('!!!')).toBe(false);
  });
});
