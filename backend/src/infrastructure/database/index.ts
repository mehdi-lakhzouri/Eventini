export {
  USER_STATUSES,
  ORGANIZATION_STATUSES,
  MEMBERSHIP_STATUSES,
  ROLE_SCOPES,
  PLATFORM_ROLE_ASSIGNMENT_STATUSES,
  IDEMPOTENCY_STATUSES,
  CHECK_CONSTRAINT_VALUES,
  type IdempotencyStatus,
  type UserStatus,
  type OrganizationStatus,
  type MembershipStatus,
  type RoleScope,
  type PlatformRoleAssignmentStatus,
} from './enums';
export { ID_PREFIXES, newId, hasPrefix, type IdPrefix } from './identifiers';
export { uuidV7 } from './uuid-v7';
export { normalizeEmail } from './normalize-email';
export { PrismaService, type PrismaConnectionSettings } from './prisma.service';
export {
  TransactionManager,
  type TransactionalClient,
} from './transaction.manager';
export { PrismaModule } from './prisma.module';

// --- Tenant isolation, EVT-018 / ADR-0003 -----------------------------------
//
// `TENANT_SCOPED_PRISMA` is what a repository injects. `PrismaService` above
// stays exported as a class — tests construct it directly — but `PrismaModule`
// does not export it as a provider, so it cannot be injected.
export { TENANT_SCOPED_PRISMA } from './prisma.tokens';
export {
  withTenantScope,
  tenantScopeExtension,
  setUnscopedQueryReporter,
  resetUnscopedQueryReporter,
  type TenantScopedPrismaClient,
} from './tenant-scope.extension';
export { TenantScopeViolationError } from './tenant-scope.error';
export {
  TENANT_OWNERSHIP,
  TENANT_OWNED_MODELS,
  ownershipOf,
  requiresOrganizationScope,
  type ClassifiedModel,
  type TenantOwnership,
} from './tenant-ownership';
export {
  currentUnscopedReason,
  isUnscopedContext,
  runUnscoped,
  type UnscopedContext,
} from './unscoped-context';
