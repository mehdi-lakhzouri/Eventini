import { normalizeEmail } from './normalize-email';

describe('normalizeEmail', () => {
  it('lowercases, so one person cannot register twice by changing case', () => {
    expect(normalizeEmail('Admin@Example.COM')).toBe('admin@example.com');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeEmail('  admin@example.com \t')).toBe('admin@example.com');
  });

  it('is idempotent', () => {
    const once = normalizeEmail(' Admin@Example.COM ');

    expect(normalizeEmail(once)).toBe(once);
  });

  /**
   * The case NFC would miss. U+FB01 is the `fi` ligature: it renders
   * identically to `fi` in most fonts, so `oﬃce@x.com` and `office@x.com` are
   * indistinguishable to anyone reviewing an access list.
   */
  it('folds compatibility characters onto their plain equivalents', () => {
    expect(normalizeEmail('oﬃce@example.com')).toBe('office@example.com');
  });

  /** Fullwidth Latin, as produced by CJK input methods. */
  it('folds fullwidth letters', () => {
    expect(normalizeEmail('ａdmin@example.com')).toBe('admin@example.com');
  });

  /**
   * The fold runs before the lowercase, because it can produce uppercase:
   * U+2160 ROMAN NUMERAL ONE becomes `I`, which then has to become `i`.
   */
  it('lowercases characters produced by the fold itself', () => {
    expect(normalizeEmail('Ⅰvan@example.com')).toBe('ivan@example.com');
  });

  /** NFKC turns the ideographic space into an ordinary one, which then trims. */
  it('trims whitespace that only becomes whitespace after folding', () => {
    expect(normalizeEmail('　admin@example.com　')).toBe('admin@example.com');
  });

  /**
   * Deliberately not provider-canonicalised. `a.b@gmail.com` and `ab@gmail.com`
   * reach the same mailbox at Google and different mailboxes almost everywhere
   * else, so collapsing them here would merge two genuinely different accounts
   * on any other host.
   */
  it('leaves the local part otherwise intact', () => {
    expect(normalizeEmail('a.b+tag@example.com')).toBe('a.b+tag@example.com');
  });
});
