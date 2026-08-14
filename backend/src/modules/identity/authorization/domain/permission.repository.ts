/**
 * The effective permission codes for one scope, read from PostgreSQL.
 *
 * PostgreSQL is the source of truth; the cache in front of it is an
 * optimisation with a version, never an authority. ADR-0004's fallback is a
 * read straight through this port — never a fallback to "allow".
 */
export abstract class PermissionRepository {
  /**
   * `ORGANIZATION`-scoped roles held through one membership.
   *
   * Scoped by `membershipId`, which already belongs to one organization, so
   * the answer cannot span tenants however the caller asks.
   */
  abstract organizationPermissions(membershipId: string): Promise<string[]>;

  /** `PLATFORM`-scoped roles held directly by the user. */
  abstract platformPermissions(userId: string): Promise<string[]>;

  /**
   * `EVENT`-scoped permissions for one membership on one event.
   *
   * ADR-0004: an organization permission does **not** imply access to every
   * event. A user can administer organization A, analyse B, and be authorised
   * on exactly one of B's events — the model supports that literally, so the
   * event grant has to be looked up on its own rather than inferred.
   *
   * `at` is passed in rather than read inside: the validity window is part of
   * the SQL filter (`valid_from <= at <= valid_until`), and taking the clock
   * as an argument is what lets a test place a grant in the past or the
   * future and prove the window is enforced by the query.
   */
  abstract eventPermissions(
    membershipId: string,
    eventId: string,
    at: Date,
  ): Promise<string[]>;

  /**
   * Les **codes de rôle** tenus par un membership, et non leurs permissions.
   *
   * Deux lectures distinctes parce que ce sont deux questions distinctes. Un
   * rôle est une étiquette destinée à l'affichage — « vous êtes administrateur
   * de cette organisation » — là où une permission autorise une action. Les
   * déduire l'une de l'autre est faux dans les deux sens : deux rôles peuvent
   * accorder la même permission, et un rôle sans permission reste un rôle.
   *
   * Le filtre `scope = 'ORGANIZATION'` est repris tel quel de la lecture des
   * permissions : un rôle PLATFORM atteignable par une assignation de
   * membership serait l'escalade de privilège la plus directe que ce schéma
   * autorise (INV-09 la refuse en base, ce filtre la refuse en lecture).
   */
  abstract organizationRoles(membershipId: string): Promise<string[]>;

  /** Les codes de rôle `PLATFORM` tenus directement par l'utilisateur. */
  abstract platformRoles(userId: string): Promise<string[]>;
}
