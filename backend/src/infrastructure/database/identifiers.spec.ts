import { ID_PREFIXES, hasPrefix, newId } from './identifiers';

describe('newId', () => {
  it('prefixes the identifier with its type', () => {
    expect(newId(ID_PREFIXES.user)).toMatch(/^usr_/);
    expect(newId(ID_PREFIXES.organization)).toMatch(/^org_/);
  });

  it('produces a well-formed UUID after the prefix', () => {
    const [, uuid] = newId(ID_PREFIXES.event).split('_');

    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  /**
   * §2.1 asks for v7 specifically, not merely "a UUID". Version 7 carries a
   * millisecond timestamp in its high bits, which is what preserves insertion
   * locality on `attendance_records` and `audit_logs`.
   */
  it('generates version 7, not version 4', () => {
    const [, uuid] = newId(ID_PREFIXES.auditLog).split('_');

    // The version nibble is the first character of the third group.
    expect(uuid?.split('-')[2]?.[0]).toBe('7');
  });

  /**
   * The property that makes v7 worth choosing: ids generated later sort after
   * ids generated earlier, so an index append stays an append.
   */
  it('sorts in generation order', () => {
    const ids = Array.from({ length: 50 }, () => newId(ID_PREFIXES.attendance));

    expect([...ids].sort()).toEqual(ids);
  });

  it('does not repeat itself', () => {
    const ids = new Set(
      Array.from({ length: 5_000 }, () => newId(ID_PREFIXES.ticket)),
    );

    expect(ids.size).toBe(5_000);
  });

  it.each(Object.values(ID_PREFIXES))('supports the %s prefix', (prefix) => {
    expect(newId(prefix).startsWith(`${prefix}_`)).toBe(true);
  });
});

describe('hasPrefix', () => {
  it('recognises an identifier of the right type', () => {
    expect(hasPrefix(newId(ID_PREFIXES.user), ID_PREFIXES.user)).toBe(true);
  });

  /**
   * The bug this catches: passing an event id where a session id was
   * expected, which without prefixes is a lookup that silently returns
   * nothing.
   */
  it('rejects an identifier of a different type', () => {
    expect(hasPrefix(newId(ID_PREFIXES.event), ID_PREFIXES.eventSession)).toBe(
      false,
    );
  });

  it('is not fooled by a prefix that is merely a substring', () => {
    // `evt` is not a prefix of `esn`, and neither should match the other.
    expect(hasPrefix('evtsomething', ID_PREFIXES.event)).toBe(false);
  });
});

describe('ID_PREFIXES', () => {
  it('is free of duplicates, so a prefix identifies exactly one type', () => {
    const values = Object.values(ID_PREFIXES);

    expect(new Set(values).size).toBe(values.length);
  });
});
