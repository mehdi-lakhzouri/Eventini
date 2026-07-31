/**
 * The server-resolved tenant context — ADR-0002, ADR-0003.
 *
 * ## Why this is a type and not a string
 *
 * ADR-0003 requires every repository method on a tenant-owned model to take
 * the context as its **first** parameter, never optional, never a bare
 * `string`. The reasoning is worth keeping next to the type: a `string` gets
 * passed by mistake — an event id where an organization id was expected
 * compiles, runs, and silently returns nothing or, worse, someone else's row.
 * A dedicated type cannot be fabricated by accident; it only comes out of the
 * authorization chain.
 *
 * ## Where the values come from, and where they must never come from
 *
 * ```
 * Cookie __Host-eventini_access → claim sid
 *   → user_sessions.organization_id + active_membership_id
 *   → TenantContext
 * ```
 *
 * An `organizationId` arriving from the client — path, query or body — is
 * **never** used to build a query. It is only ever compared against this
 * context; a divergence is `403 AUTH_TENANT_DENIED` plus a
 * `TENANT_ACCESS_DENIED` security event. A caller who can choose which tenant
 * their queries run against has broken tenant isolation, and a caller who can
 * choose which tenant their actions are *logged* under has broken the audit
 * trail — the second is quieter and worse.
 *
 * The guard that builds this from a session arrives with EVT-036 (sprint 06).
 * The type exists now because ADR-0003 puts the isolation guard before the
 * first repository: every query written without it has to be rewritten.
 */

/** ADR-0005, `al` claim. */
export type AuthLevel = 'PASSWORD' | 'MFA' | 'REAUTHENTICATED';

export interface TenantContext {
  /** `user_sessions.organization_id`. The only value a query may scope on. */
  readonly organizationId: string;

  /** `user_sessions.active_membership_id`. */
  readonly membershipId: string;

  readonly userId: string;
  readonly sessionId: string;
  readonly authLevel: AuthLevel;
}

/**
 * A platform-scoped session — `SUPER_ADMIN` acting on the platform itself.
 *
 * ADR-0002: these sessions carry `organization_id IS NULL` and
 * `active_membership_id IS NULL`, which `ck_sessions_tenant_coherence` will
 * enforce once migration 5 lands (C-29). They are deliberately a *different
 * type* rather than a `TenantContext` with nullable fields: making the
 * organization id optional would put an `if (ctx.organizationId)` at every
 * call site, and the branch that forgets it is the one that leaks.
 *
 * Code that needs to run without a tenant filter goes through
 * `$unscoped`, which is explicit, logged and alertable.
 */
export interface PlatformContext {
  readonly userId: string;
  readonly sessionId: string;
  readonly authLevel: AuthLevel;
}

export type RequestContext = TenantContext | PlatformContext;

/** Narrows a request context to the tenant case. */
export function isTenantContext(
  context: RequestContext,
): context is TenantContext {
  return 'organizationId' in context;
}
