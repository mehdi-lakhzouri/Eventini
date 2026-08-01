/**
 * Which models the tenant guard defends, and which it deliberately does not —
 * sprint-03 EVT-018, ADR-0003.
 *
 * DATABASE_SCHEMA.md §2.4 names four ownership categories, and §3 assigns one
 * to each of the 30 tables. This file is that assignment in code, for the
 * models that exist today.
 *
 * ## The list is a set of exemptions, not a set of protections
 *
 * ADR-0003 and BACKEND_ARCHITECTURE.md §6 both write the check as
 * `TENANT_OWNED_MODELS.has(model)` — an allow-list of models to enforce. This
 * file inverts it: **a model nobody has classified is treated as tenant-owned
 * and its queries are refused.**
 *
 * The inversion is deliberate, and it follows from the ADR's own principle
 * rather than contradicting it. Under an allow-list, forgetting to register a
 * new tenant table leaves it *silently unprotected*: every query works, no
 * test fails, and the gap is invisible until someone reads another tenant's
 * data. Under this deny-list, the same mistake makes every query on that
 * model throw immediately, with the model named in the message. "Fail closed:
 * en cas de doute, on refuse" is the ADR's sentence; an allow-list fails open
 * on the one case that matters, which is the case of forgetting.
 *
 * `TENANT_OWNED_MODELS` is still exported, so the name the documents use
 * continues to mean what they say it means.
 */

/** DATABASE_SCHEMA.md §2.4, plus the two cases §3 and §5.6 use in practice. */
export type TenantOwnership =
  /** Global data, outside any tenant. No filter required. */
  | 'PLATFORM'
  /** Shared reference data, seeded and read-only at runtime. */
  | 'GLOBAL_REFERENCE'
  /** `organization_id NOT NULL` as a direct column. */
  | 'ORGANIZATION_OWNED'
  /** `event_id NOT NULL` **and** `organization_id NOT NULL`, denormalised. */
  | 'EVENT_OWNED'
  /**
   * `organization_id` exists but is nullable: the row belongs to a tenant in
   * some cases and to the platform in others. §3 calls these "mixte".
   */
  | 'TENANT_OPTIONAL';

/**
 * The Prisma model names, classified. Keys are model names as Prisma reports
 * them to an extension — PascalCase, not the `@@map`ped table name.
 *
 * Only the models that exist today are listed. A model added by a later
 * migration and not added here will fail closed, loudly, on its first query;
 * `tenant-ownership.spec.ts` also fails, which is the earlier of the two
 * signals.
 */
export const TENANT_OWNERSHIP = {
  // --- Migration 1, identity -----------------------------------------------
  /** Platform-wide identity; membership is what ties a user to a tenant. */
  User: 'PLATFORM',
  UserCredential: 'PLATFORM',
  /** The tenant itself. A tenant cannot be scoped by its own id. */
  Organization: 'PLATFORM',
  OrganizationMembership: 'ORGANIZATION_OWNED',

  // --- Migration 2, authorization ------------------------------------------
  Role: 'GLOBAL_REFERENCE',
  Permission: 'GLOBAL_REFERENCE',
  RolePermission: 'GLOBAL_REFERENCE',

  // Carries organization_id since EVT-021's migration 4, which closed the
  // ADR-0003 §1 gap EVT-018 had to work around with a relation filter.
  MembershipRoleAssignment: 'ORGANIZATION_OWNED',
  /** A platform grant has no organization by construction (INV-09). */
  PlatformRoleAssignment: 'PLATFORM',

  // --- Migration 3, events -------------------------------------------------
  Event: 'ORGANIZATION_OWNED',
  EventSession: 'EVENT_OWNED',
  EventUserAssignment: 'EVENT_OWNED',

  // --- Migrations 4-6, sessions, tokens and MFA ----------------------------
  UserInvitation: 'ORGANIZATION_OWNED',
  EmailVerificationToken: 'PLATFORM',
  PasswordResetToken: 'PLATFORM',
  MfaMethod: 'PLATFORM',
  MfaRecoveryCode: 'PLATFORM',

  /**
   * Mixed: a platform session has no organization at all (ADR-0002), which
   * `ck_sessions_tenant_coherence` encodes. A guard demanding the filter would
   * make a SUPER_ADMIN session unwritable.
   */
  UserSession: 'TENANT_OPTIONAL',

  /**
   * No `organization_id` of its own, by design: a rotation is reached through
   * its session or by token hash, never listed per tenant. Scoping it would
   * mean joining to a column that is itself nullable.
   */
  RefreshTokenRotation: 'TENANT_OPTIONAL',

  // --- Migration 8, audit --------------------------------------------------
  /**
   * Mixed, and the guard cannot help here — see the note below on what that
   * costs. A failed login has no organization yet; an organization-scoped
   * permission denial does.
   */
  SecurityEvent: 'TENANT_OPTIONAL',
  AuditLog: 'TENANT_OPTIONAL',
} as const satisfies Record<string, TenantOwnership>;

export type ClassifiedModel = keyof typeof TENANT_OWNERSHIP;

/**
 * The ownership of a model, or `undefined` if it has never been classified.
 *
 * `undefined` is not "no ownership" — it is "nobody has said", which the
 * guard treats as tenant-owned.
 */
export function ownershipOf(model: string): TenantOwnership | undefined {
  return Object.prototype.hasOwnProperty.call(TENANT_OWNERSHIP, model)
    ? TENANT_OWNERSHIP[model as ClassifiedModel]
    : undefined;
}

/**
 * Whether a query on this model must carry an `organizationId` constraint.
 *
 * ## `TENANT_OPTIONAL` is the weak spot, and it is a real one
 *
 * `security_events` and `audit_logs` carry a nullable `organization_id`,
 * because some of what they record happens before any tenant is known — a
 * failed login against an address that belongs to nobody, a CSRF rejection on
 * an anonymous request. A guard that demanded a filter would make those rows
 * unwritable; a guard that demanded one only on reads would still be wrong,
 * since a platform administrator legitimately reads across tenants.
 *
 * So these two models are exempt, and the isolation of *their* reads is a
 * matter of authorization rather than of this guard — `platform.*` permissions
 * for the cross-tenant view, an `organizationId` filter supplied by the caller
 * for the tenant view. That is a weaker guarantee than the rest of the schema
 * gets, it is not an oversight, and it is written down here so the next person
 * does not have to rediscover why.
 */

export function requiresOrganizationScope(model: string): boolean {
  const ownership = ownershipOf(model);

  // Unclassified. Fail closed.
  if (ownership === undefined) {
    return true;
  }

  return ownership === 'ORGANIZATION_OWNED' || ownership === 'EVENT_OWNED';
}

/** The set ADR-0003 and BACKEND_ARCHITECTURE.md §6 refer to by this name. */
export const TENANT_OWNED_MODELS: ReadonlySet<string> = new Set(
  Object.keys(TENANT_OWNERSHIP).filter(requiresOrganizationScope),
);
