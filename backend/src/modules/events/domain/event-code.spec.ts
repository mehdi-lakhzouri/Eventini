import {
  EVENT_CODE_LENGTH,
  generateEventCode,
  isValidEventCode,
  normalizeEventCode,
} from './event-code';

describe('generateEventCode', () => {
  it('produces the length §6.1 specifies', () => {
    expect(generateEventCode()).toHaveLength(EVENT_CODE_LENGTH);
  });

  it('uses only Crockford base32 characters', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(isValidEventCode(generateEventCode())).toBe(true);
    }
  });

  /**
   * The four excluded characters are the whole reason for using Crockford
   * rather than plain base32: I and L read as 1, O reads as 0, and U is
   * dropped to avoid accidental profanity. Someone is typing this off a
   * printed sheet at a venue door.
   */
  it.each(['I', 'L', 'O', 'U'])(
    'never emits the ambiguous character %s',
    (character) => {
      const sample = Array.from({ length: 300 }, () =>
        generateEventCode(),
      ).join('');

      expect(sample).not.toContain(character);
    },
  );

  /**
   * Not a proof of randomness — that is what using a CSPRNG is for — but it
   * does catch a generator that has silently become constant, which is the
   * realistic regression.
   */
  it('does not repeat itself across many draws', () => {
    const codes = new Set(
      Array.from({ length: 2_000 }, () => generateEventCode()),
    );

    expect(codes.size).toBeGreaterThan(1_990);
  });

  it('covers most of the alphabet over enough draws', () => {
    const seen = new Set(
      Array.from({ length: 500 }, () => generateEventCode()).join(''),
    );

    // 32 symbols; a biased or truncated alphabet shows up immediately here.
    expect(seen.size).toBeGreaterThanOrEqual(30);
  });

  it('honours an explicit length', () => {
    expect(generateEventCode(12)).toHaveLength(12);
  });
});

describe('normalizeEventCode', () => {
  it.each([
    ['abcdefgh', 'ABCDEFGH'],
    ['ABCD-EFGH', 'ABCDEFGH'],
    ['  ABCDEFGH  ', 'ABCDEFGH'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeEventCode(input)).toBe(expected);
  });

  /**
   * Crockford's decoding rules. These are the misreadings the alphabet was
   * chosen to survive, so accepting them is the other half of that choice.
   */
  it.each([
    ['I', '1'],
    ['L', '1'],
    ['O', '0'],
    ['i', '1'],
    ['o', '0'],
  ])('decodes the ambiguous character %s as %s', (input, expected) => {
    expect(normalizeEventCode(input)).toBe(expected);
  });

  it('normalises a code a human might mistype into the canonical form', () => {
    expect(normalizeEventCode('  o1ab-cIeL ')).toBe('01ABC1E1');
  });
});

describe('isValidEventCode', () => {
  it('accepts a generated code', () => {
    expect(isValidEventCode(generateEventCode())).toBe(true);
  });

  it.each([
    ['too short', 'ABC'],
    ['too long', 'ABCDEFGHJ'],
    ['contains an excluded character', 'ABCDEFGI'],
    ['contains a symbol', 'ABCDEF-H'],
    ['lowercase', 'abcdefgh'],
    ['empty', ''],
  ])('rejects a code that is %s', (_label, code) => {
    expect(isValidEventCode(code)).toBe(false);
  });
});
