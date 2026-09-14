/**
 * Makes user text literal inside a Prisma `contains` / `startsWith` /
 * `endsWith` filter.
 *
 * On PostgreSQL those filters compile to `LIKE` / `ILIKE`, and Prisma passes
 * the value through unescaped: `%` and `_` keep their wildcard meaning. A
 * search for `%%` then matches every row of the table — within the tenant,
 * but still a full listing handed to a search box whose length floor exists
 * precisely to prevent one. Verified against Prisma 7.9 by the participants
 * e2e suite, not assumed.
 *
 * Backslash is PostgreSQL's default `LIKE` escape character, so it is escaped
 * first; otherwise a trailing `\` would escape the pattern's own closing `%`.
 */
export function escapeLikePattern(text: string): string {
  return text.replace(/[\\%_]/g, (character) => `\\${character}`);
}
