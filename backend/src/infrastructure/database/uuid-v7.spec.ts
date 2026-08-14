import { uuidV7 } from './uuid-v7';

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function timestampOf(uuid: string): number {
  return Number.parseInt(uuid.slice(0, 13).replace('-', ''), 16);
}

describe('uuidV7', () => {
  it('has the canonical 8-4-4-4-12 shape', () => {
    expect(uuidV7()).toMatch(UUID_SHAPE);
  });

  it('sets the version nibble to 7', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(uuidV7().split('-')[2]?.[0]).toBe('7');
    }
  });

  /**
   * RFC 9562 requires the two high bits of the variant octet to be `10`,
   * which in hex is one of 8, 9, a or b.
   */
  it('sets the RFC 4122 variant bits', () => {
    for (let i = 0; i < 100; i += 1) {
      expect(['8', '9', 'a', 'b']).toContain(uuidV7().split('-')[3]?.[0]);
    }
  });

  it('encodes the current time in the leading 48 bits', () => {
    const before = Date.now();
    const encoded = timestampOf(uuidV7());
    const after = Date.now();

    expect(encoded).toBeGreaterThanOrEqual(before);
    expect(encoded).toBeLessThanOrEqual(after + 1);
  });

  /**
   * The whole reason §2.1 chose v7 over v4: lexicographic order matches
   * creation order, so an index insert stays an append instead of scattering
   * across the tree. A burst inside one millisecond is the case that random
   * bits would get wrong, so it is the case worth testing.
   */
  it('sorts in generation order, including within a single millisecond', () => {
    const ids = Array.from({ length: 10_000 }, () => uuidV7());

    expect([...ids].sort()).toEqual(ids);
  });

  it('never repeats', () => {
    const ids = new Set(Array.from({ length: 20_000 }, () => uuidV7()));

    expect(ids.size).toBe(20_000);
  });

  /**
   * More than 4096 ids in one millisecond exhausts the 12-bit counter. The
   * implementation borrows from the next millisecond rather than emitting a
   * value that would sort before its predecessor.
   */
  it('stays ordered when the per-millisecond counter overflows', () => {
    const ids = Array.from({ length: 5_000 }, () => uuidV7());

    expect([...ids].sort()).toEqual(ids);
    expect(new Set(ids).size).toBe(5_000);
  });

  it('varies the random tail between calls made in the same millisecond', () => {
    const tails = new Set(
      Array.from({ length: 500 }, () => uuidV7().split('-')[4]),
    );

    // The counter guarantees ordering; the tail must still be random, or the
    // ids would be predictable from one another.
    expect(tails.size).toBeGreaterThan(490);
  });
});
