import { Prisma } from './prisma/generated/client';
import type { PrismaClient } from './prisma/generated/client';
import { hasOrganizationScope } from './organization-scope';
import { requiresOrganizationScope } from './tenant-ownership';
import { TenantScopeViolationError } from './tenant-scope.error';
import {
  currentUnscopedReason,
  isUnscopedContext,
  runUnscoped,
} from './unscoped-context';

/**
 * The tenant isolation guard — sprint-03 EVT-018, ADR-0003.
 *
 * ## Why a runtime guard exists at all
 *
 * Three documents state the rule (A §10.3, B §31, C §25.3/§26.3): never
 * `findById(id)` without a tenant filter. None of them said how the rule is
 * prevented from being forgotten, and a rule that depends on being remembered
 * is a rule that holds until the first tired afternoon. This turns it into a
 * failure that happens in a test rather than a cross-tenant read that happens
 * in production.
 *
 * ## Why it ships before the first repository
 *
 * Invariant O-5. Adding the guard afterwards means auditing and rewriting
 * every query already written; adding it first means the first repository is
 * written against it.
 *
 * ## What it does not cover, stated plainly
 *
 * - **`$queryRaw` / `$executeRaw`.** Verified against a live client: raw SQL
 *   never reaches `$allModels`, so it is invisible here. The security
 *   workflow already flags raw SQL for review, and that review is now load
 *   bearing rather than advisory.
 * - **Relation loads.** `organization.findMany({ include: { memberships:
 *   true } })` fires exactly one operation — the parent's — so an included
 *   tenant model is not separately checked. It does not need to be: the rows
 *   come back through a foreign key from a row the caller already reached.
 * - **Nested writes.** Same mechanism, same reasoning; INV-01's triggers
 *   enforce that a child's organization matches its parent's in the database.
 * - **Direct SQL access.** psql, a BI tool, a migration script. ADR-0003 is
 *   explicit that this guarantee is applicative, and that PostgreSQL RLS
 *   would be an addition rather than a replacement.
 *
 * ## Why the raw client must not be injectable
 *
 * `$extends` returns a *new* client; the original keeps working and is not
 * guarded — verified: a query through the base client records nothing in the
 * extension. So `PrismaModule` provides the raw `PrismaService` for its
 * lifecycle hooks and does **not** export it. What application code can
 * inject is the extended client, and that is the only reason this guard is
 * more than a suggestion.
 */

export const tenantScopeExtension = Prisma.defineExtension({
  name: 'eventini-tenant-scope',

  client: {
    /**
     * The single, explicit escape hatch — ADR-0003.
     *
     * Reserved for platform operations: the seed, a `SUPER_ADMIN` acting
     * across tenants, a maintenance job. It takes a reason because the `warn`
     * line it emits is meant to be alerted on in production, and an alert
     * that cannot be triaged gets muted.
     *
     * Deliberately a callback rather than a flag or a second client: the
     * exemption then has a visible beginning and end in the source, and
     * cannot outlive the operation that needed it.
     */
    $unscoped<T>(this: unknown, reason: string, work: () => Promise<T>) {
      return runUnscoped(reason, work);
    },
  },

  query: {
    $allModels: {
      $allOperations({ model, operation, args, query }) {
        if (!requiresOrganizationScope(model)) {
          return query(args);
        }

        if (isUnscopedContext()) {
          reportUnscopedQuery(model, operation, currentUnscopedReason());
          return query(args);
        }

        const verdict = hasOrganizationScope(operation, args);

        if (!verdict.scoped) {
          throw new TenantScopeViolationError(model, operation, verdict.reason);
        }

        return query(args);
      },
    },
  },
});

/**
 * The observability half of the escape hatch.
 *
 * `eventCode: UNSCOPED_QUERY_EXECUTED` is required by ADR-0003 and by
 * BACKEND_ARCHITECTURE.md §6, and is already a `SecurityEventType` in
 * `enums.ts`. It was **missing** from the Pino catalogue in
 * `log-event-codes.ts` and from PINO_LOGGING_SPECIFICATION.md §10's list;
 * EVT-018 adds it, because a code the architecture mandates and the catalogue
 * does not contain cannot be alerted on.
 */
type UnscopedQueryReporter = (
  model: string,
  operation: string,
  reason: string | undefined,
) => void;

let reportUnscopedQuery: UnscopedQueryReporter = () => {
  // No-op until the module wires a logger in. Chosen over throwing so that a
  // unit test constructing the extension by hand does not have to provide
  // one, and over a console.log so that a forgotten wiring is silent in tests
  // rather than noisy in every suite.
};

/**
 * Installs the reporter. Called once by `PrismaModule`, which is the only
 * place that has a logger and knows the environment.
 */
export function setUnscopedQueryReporter(
  reporter: UnscopedQueryReporter,
): void {
  reportUnscopedQuery = reporter;
}

/** Restores the default. Exists for tests, which must not leak a reporter. */
export function resetUnscopedQueryReporter(): void {
  reportUnscopedQuery = () => {};
}

/**
 * Wraps a client in the guard.
 *
 * Exported as a function rather than applied inside `PrismaService` because
 * `$extends` cannot extend an instance in place: it returns a new object of a
 * different type. Making that explicit here keeps `PrismaService` a plain
 * lifecycle owner and gives the extended type a name.
 */
export function withTenantScope(client: PrismaClient) {
  return client.$extends(tenantScopeExtension);
}

/**
 * The client every repository will hold. Derived from `withTenantScope` so
 * that it stays correct as models are added, rather than being restated.
 */
export type TenantScopedPrismaClient = ReturnType<typeof withTenantScope>;
