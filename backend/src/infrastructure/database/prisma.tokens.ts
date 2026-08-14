/**
 * The injection token for the tenant-scoped client — sprint-03 EVT-018.
 *
 * In its own file so that `PrismaModule`, `TransactionManager` and every
 * future repository can import it without importing the module, which is
 * what would otherwise make the dependency graph circular.
 *
 * ## Why a token instead of injecting `PrismaService`
 *
 * `PrismaService extends PrismaClient`, and `$extends` returns a different
 * object rather than modifying that one — verified: a query issued through
 * the unextended client is invisible to the extension. If `PrismaService`
 * stayed injectable, every repository would have a one-word way to bypass
 * tenant isolation, and it would look like the obvious thing to type.
 *
 * So `PrismaModule` keeps `PrismaService` private for its lifecycle hooks and
 * exports this token instead. The guard is then structural: there is no
 * unguarded client to reach for.
 */
export const TENANT_SCOPED_PRISMA = Symbol('TENANT_SCOPED_PRISMA');
