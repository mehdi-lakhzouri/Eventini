/**
 * `csrfHeaderName` used to live here and was imported by
 * `lib/api/csrf-client.ts`, which made `lib/` depend on a feature — forbidden
 * by `MODULE_DEPENDENCY_MAP.md` §7. It moved to `@/lib/api/csrf-client` as
 * `CSRF_HEADER_NAME`, next to the only code that uses it.
 *
 * Query keys stay here: they are the authentication feature's cache contract,
 * consumed only by its own hooks.
 */
export const authenticationQueryKeys = {
  currentUser: ["authentication", "current-user"] as const,
  sessions: ["authentication", "sessions"] as const,
};
