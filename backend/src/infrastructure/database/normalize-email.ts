/**
 * The definition of `users.normalized_email`.
 *
 * `schema.prisma` states the column is "lowercased, trimmed, NFKC-normalised"
 * and that uniqueness and rate limiting key on it. That sentence is a contract
 * on every writer of the column, so it is implemented once, here, rather than
 * re-derived at each call site — two writers disagreeing by one step is how
 * `A@x.com` and `a@x.com` end up as two accounts, and how a login attempt
 * dodges a per-email limiter by changing case.
 *
 * ## Why NFKC and not NFC
 *
 * Unicode has several distinct code points that render as the same letter.
 * `ﬁ` (U+FB01, the fi ligature) and `fi` are visually identical in most fonts,
 * as are the fullwidth Latin letters `ａ`–`ｚ` used by CJK input methods. NFC
 * leaves those distinct; NFKC folds them onto their compatibility equivalents.
 * Without it, `ａdmin@x.com` registers alongside `admin@x.com` and reads the
 * same to a human reviewing an access list.
 *
 * Order matters: NFKC runs before lowercasing, because the fold can produce
 * uppercase characters (`Ⅰ` U+2160 becomes `I`) that then need lowering.
 *
 * ## What this deliberately does not do
 *
 * No provider-specific canonicalisation — dots are not stripped from Gmail
 * addresses and `+tag` suffixes are not removed. Those rules belong to
 * individual providers, change without notice, and applying them would make
 * two addresses that genuinely deliver to different mailboxes collide on some
 * hosts. The local part is treated as opaque, which is what RFC 5321 says it
 * is.
 */
export function normalizeEmail(email: string): string {
  return email.normalize('NFKC').trim().toLowerCase();
}
