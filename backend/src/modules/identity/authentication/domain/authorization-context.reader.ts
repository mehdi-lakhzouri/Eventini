/**
 * What `GET /auth/me` may tell the browser about the caller's authority.
 *
 * ## 🔴 Advisory. Never authoritative.
 *
 * These values exist so the interface can avoid rendering an action that would
 * be refused — hiding a button the user cannot use is courtesy, not security.
 * Every request is still authorised server-side, from scratch, by the guard
 * chain (ADR-0004). A client that forged this payload would gain exactly
 * nothing: the backend never reads it back.
 *
 * They are equally **never put in the token**. A JWT is signed once and lives
 * for its whole lifetime; permissions change the moment a role is revoked. A
 * token carrying them would keep granting access until it expired, which is
 * the property ADR-0004 exists to prevent.
 */
export interface AuthorizationContext {
  /**
   * The caller's role in the active organization, or their platform role when
   * the session is not scoped to one.
   *
   * `null` when the caller holds none — a user invited but not yet assigned,
   * or a platform session with no platform role. The interface must treat
   * `null` as "no special authority", never as "not loaded".
   */
  readonly role: string | null;
  /** Effective permission codes for the active scope. Possibly empty. */
  readonly permissions: readonly string[];
}

/**
 * The port `CurrentUserController` depends on.
 *
 * A port rather than a direct call, because the resolver lives in
 * `authorization` and `authorization` already depends on `authentication` —
 * the guards read `CallerResolver`. Importing back the other way would make a
 * cycle between the two, which `MODULE_DEPENDENCY_MAP.md` §5 forbids and
 * points at this exact resolution: "à résoudre par outbox ou port".
 *
 * So the arrow keeps its direction. Authentication states what it needs;
 * authorization supplies it, since it is the side allowed to know both.
 */
export abstract class AuthorizationContextReader {
  abstract read(caller: {
    readonly userId: string;
    readonly membershipId: string | null;
  }): Promise<AuthorizationContext>;
}
