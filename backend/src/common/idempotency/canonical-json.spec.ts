import { canonicalJson } from './canonical-json';

describe('canonicalJson', () => {
  /** Test 7 of IDEMPOTENCY_AND_CONCURRENCY.md §13, at the unit level. */
  it('serialises reordered keys identically', () => {
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
  });

  it('sorts keys at every depth', () => {
    expect(canonicalJson({ b: { d: 1, c: 2 }, a: 3 })).toBe(
      '{"a":3,"b":{"c":2,"d":1}}',
    );
  });

  it('leaves array order alone', () => {
    expect(canonicalJson([1, 2])).not.toBe(canonicalJson([2, 1]));
  });

  /**
   * `{"a":null}` and `{}` are two different intentions — a client clearing a
   * field is not a client leaving it alone.
   */
  it('keeps null and drops undefined', () => {
    expect(canonicalJson({ a: null })).toBe('{"a":null}');
    expect(canonicalJson({ a: undefined })).toBe('{}');
  });

  it('emits no whitespace between tokens', () => {
    expect(canonicalJson({ a: [1, { b: 'x' }] })).toBe('{"a":[1,{"b":"x"}]}');
  });

  it.each([
    [1e21, '1000000000000000000000'],
    [1e-7, '0.0000001'],
    [1.5e-7, '0.00000015'],
    [-1.25e21, '-1250000000000000000000'],
    [1.5, '1.5'],
    [0, '0'],
    [-0, '0'],
  ])('writes %p without scientific notation as %s', (value, expected) => {
    expect(canonicalJson(value)).toBe(expected);
  });

  /**
   * The threshold at which `String` switches to exponent form is a property of
   * the magnitude, not of the request — so a body that crosses it must not
   * hash differently depending on which side of it the number landed.
   */
  it('agrees with JSON.stringify below the exponent threshold', () => {
    for (const value of [0, 1, -1, 42, 3.14159, 1e20, 1e-6]) {
      expect(canonicalJson(value)).toBe(JSON.stringify(value));
    }
  });

  it('escapes strings the way JSON does', () => {
    expect(canonicalJson('a"b\n')).toBe('"a\\"b\\n"');
  });

  it.each([
    [Number.NaN],
    [Number.POSITIVE_INFINITY],
    [Number.NEGATIVE_INFINITY],
  ])('writes %p as null, matching JSON.stringify', (value) => {
    expect(canonicalJson(value)).toBe('null');
  });

  it('serialises the scalars', () => {
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson(false)).toBe('false');
  });
});
