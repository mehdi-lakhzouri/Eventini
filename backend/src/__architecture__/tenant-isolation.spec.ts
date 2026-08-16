import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { Prisma } from '../infrastructure/database/prisma/generated/client';
import { ownershipOf } from '../infrastructure/database/tenant-ownership';

/**
 * The isolation rules, checked against the source tree — ADR-0003 §4,
 * MODULE_DEPENDENCY_MAP.md §6.3, implemented by EVT-018.
 *
 * MODULE_DEPENDENCY_MAP.md calls this "le test le plus important du dépôt".
 * It held two `it.todo` until now, which is the shape a claim takes when
 * nobody has checked it.
 *
 * These are static checks over files, deliberately. The runtime guard already
 * refuses an unscoped query, but it only refuses queries that *run*; a
 * repository method with no `TenantContext` parameter is a design mistake a
 * test suite might never execute, and by the time it does the signature has
 * callers.
 */
const sourceRoot = resolve(__dirname, '..');
const schemaPath = resolve(sourceRoot, '..', 'prisma', 'schema.prisma');

function listSourceFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);

    if (statSync(fullPath).isDirectory()) {
      // The generated Prisma client is not ours to hold to these rules.
      return entry === 'generated' ? [] : listSourceFiles(fullPath);
    }

    return fullPath.endsWith('.ts') && !fullPath.endsWith('.spec.ts')
      ? [fullPath]
      : [];
  });
}

const sourceFiles = listSourceFiles(sourceRoot);

function read(filePath: string): string {
  return readFileSync(filePath, 'utf8');
}

/**
 * Strips comments and string literals, leaving only executable code.
 *
 * Both halves were needed, and the second was found the hard way: the
 * `$unscoped` allow-list flagged `tenant-scope.error.ts`, whose *error
 * message* tells the reader to "wrap a genuine platform operation in
 * prisma.$unscoped(reason, fn)". A rule that fires on the text explaining the
 * rule teaches people to add exceptions to it, which is how a check stops
 * being believed.
 */
function executableCodeOf(source: string): string {
  return source
    .replaceAll(/\/\*[\s\S]*?\*\//g, '')
    .replaceAll(/(^|[^:])\/\/.*$/gm, '$1')
    .replaceAll(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replaceAll(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replaceAll(/`(?:[^`\\]|\\.)*`/g, '``');
}

/**
 * Rule 1 — ADR-0003 §1 and §4.
 *
 * Every tenant-owned model carries `organizationId`. Asserted against
 * `schema.prisma` rather than against the classification: the classification
 * is a claim, the schema is the fact, and the guard reads the column this
 * test proves exists.
 */
describe('every tenant-owned model has organizationId', () => {
  const schema = readFileSync(schemaPath, 'utf8');

  function modelBlock(model: string): string {
    const match = new RegExp(`\\nmodel ${model} \\{([\\s\\S]*?)\\n\\}`).exec(
      schema,
    );

    return match?.[1] ?? '';
  }

  const guarded = Object.keys(Prisma.ModelName).filter((model) => {
    const ownership = ownershipOf(model);

    return ownership === 'ORGANIZATION_OWNED' || ownership === 'EVENT_OWNED';
  });

  it('finds tenant-owned models to check', () => {
    expect(guarded.length).toBeGreaterThan(0);
  });

  it.each(guarded)('%s declares organizationId', (model) => {
    expect(modelBlock(model)).toMatch(/\borganizationId\s+String\b/);
  });

  /**
   * §2.4 denormalises `organization_id` onto EVENT-owned tables specifically
   * so the guard needs no join. A nullable column would let a row exist with
   * no owner, and would make the guard's constraint satisfiable by `null`.
   */
  it.each(guarded)('%s does not make organizationId optional', (model) => {
    expect(modelBlock(model)).not.toMatch(/\borganizationId\s+String\?/);
  });
});

/**
 * Rule 2 — ADR-0003 §2.
 *
 * Repository methods take the `TenantContext` first, never optional, never a
 * bare `string`.
 *
 * ## The exemptions, and why they are files rather than a clever heuristic
 *
 * Not every table is tenant-owned, so not every repository can take a tenant
 * context: `password_reset_tokens` is `PLATFORM`, and `user_sessions` is
 * mixed — a `SUPER_ADMIN` platform session has no organization at all
 * (ADR-0002), so demanding one would make the type a lie.
 *
 * Deriving that from the file name would mean guessing which model a
 * repository fronts. An explicit list is duller and more honest: adding a
 * line to it is visible in a diff and has to be justified, and every
 * repository *not* on it — which is every repository a feature sprint will
 * add — is checked.
 */
describe('repositories take a TenantContext first', () => {
  /**
   * Repositories over PLATFORM or mixed-ownership models. Each entry is a
   * claim that the table it fronts is not tenant-owned; check §3's inventory
   * before adding one.
   */
  const NON_TENANT_REPOSITORIES = new Set([
    // password_reset_tokens — PLATFORM (§3, row 17).
    join(
      'modules',
      'identity',
      'passwords',
      'domain',
      'password-reset-token.repository.ts',
    ),
    join(
      'modules',
      'identity',
      'passwords',
      'infrastructure',
      'prisma-password-reset-token.repository.ts',
    ),
    // user_sessions — mixte (§3, row 15): NULL organization for a platform
    // session, which is exactly what ck_sessions_tenant_coherence encodes.
    join('modules', 'identity', 'sessions', 'domain', 'session.repository.ts'),
    // Authentication runs before any tenant context exists — resolving which
    // organization the session belongs to is what login is for (EVT-023).
    join(
      'modules',
      'identity',
      'authentication',
      'domain',
      'authentication.repository.ts',
    ),
    join(
      'modules',
      'identity',
      'authentication',
      'infrastructure',
      'prisma-authentication.repository.ts',
    ),
    join(
      'modules',
      'identity',
      'sessions',
      'infrastructure',
      'prisma-session.repository.ts',
    ),
    // refresh_token_rotations follows its session, and rotation is driven by
    // a cookie before any tenant context is built (EVT-024).
    join('modules', 'identity', 'sessions', 'domain', 'rotation.repository.ts'),
    // Revocation acts on the caller's own sessions, which are mixed-ownership
    // and may be platform sessions with no organization at all (EVT-025).
    // Ownership is enforced by the WHERE clause on user_id instead.
    join(
      'modules',
      'identity',
      'sessions',
      'domain',
      'revocation.repository.ts',
    ),
    join(
      'modules',
      'identity',
      'sessions',
      'infrastructure',
      'prisma-revocation.repository.ts',
    ),
    join(
      'modules',
      'identity',
      'sessions',
      'infrastructure',
      'prisma-rotation.repository.ts',
    ),
    /**
     * The organization repository answers questions *about* tenancy rather
     * than questions *within* one: which organizations the caller belongs to,
     * and whether they may switch into a given one. Both run before a context
     * for the target exists — demanding a `TenantContext` would mean demanding
     * the answer as an argument.
     *
     * Ownership is enforced by the `userId` filter instead, and the two
     * `$unscoped` calls are on rule 3's allow-list where a reviewer sees them.
     */
    join('modules', 'organizations', 'domain', 'organization.repository.ts'),
    join(
      'modules',
      'organizations',
      'infrastructure',
      'prisma-organization.repository.ts',
    ),
    /**
     * The audit log repository, added by EVT-076.
     *
     * `audit_logs` is a mixed-scope table like `user_sessions`:
     * `organization_id` is nullable, because a retention purge, a scheduled
     * job and a `SUPER_ADMIN` acting outside any tenant (ADR-0002) all write
     * rows that belong to no organization. Demanding a `TenantContext` would
     * make the type a lie for every one of those.
     *
     * Its first parameter is a `TransactionalClient` instead, and that is the
     * point of the port: EVT-044 and EVT-045 require the audit entry in the
     * same transaction as the change it describes, because a failure between
     * the two leaves a change with no trace — the worse of the two outcomes,
     * since nothing then says it happened. The organization, when there is
     * one, comes from the `TenantContext` that `AuditRecorder` takes.
     */
    join('modules', 'audit', 'domain', 'audit-log.repository.ts'),
    join(
      'modules',
      'audit',
      'infrastructure',
      'prisma-audit-log.repository.ts',
    ),
    /**
     * The security event repository, added by EVT-077.
     *
     * `security_events` is mixed-scope like `audit_logs`, and more so: every
     * actor column on it is nullable, because an event can precede identity
     * entirely. A failed login has no user, an origin rejection has no
     * session, a rate-limit denial has neither. `tenant-ownership.ts`
     * classifies the model `TENANT_OPTIONAL` for exactly that reason, so the
     * guard already exempts its queries; demanding a `TenantContext` in the
     * signature would contradict the classification.
     *
     * Unlike the audit port, it takes no transactional client either — and
     * that is the ticket's central decision rather than an omission. An event
     * written inside the caller's transaction vanishes with a rollback, which
     * is precisely the case the failure and denial events exist to record.
     * `SecurityEventRecorder` fills the organization from the `TenantContext`
     * when there is one, through `recordForContext`.
     */
    join(
      'modules',
      'identity',
      'security-events',
      'domain',
      'security-event.repository.ts',
    ),
    join(
      'modules',
      'identity',
      'security-events',
      'infrastructure',
      'prisma-security-event.repository.ts',
    ),
    /**
     * The invitation repository, added by EVT-043.
     *
     * Three of its methods precede any tenant context and cannot take one.
     * `findAssignableRole` reads `roles`, a global reference table with no
     * `organization_id` at all. `findByTokenHash` and `accept` run *before* a
     * session exists — accepting an invitation is what someone does when they
     * have no account yet, so there is no organization to scope on and
     * demanding one would make the type a lie.
     *
     * What keeps those two safe is that the token hash is the **only**
     * criterion: the caller does not choose which organization they query,
     * they present a secret that designates one. The remaining methods —
     * `create`, `listForOrganization`, `revoke` — do take the context, and are
     * the ones an authenticated administrator reaches.
     */
    join('modules', 'organizations', 'domain', 'invitation.repository.ts'),
    join(
      'modules',
      'organizations',
      'infrastructure',
      'prisma-invitation.repository.ts',
    ),
    /**
     * The permission repository resolves the context rather than consuming
     * one: it is step 6 of the chain, and steps 4 and 5 have only just decided
     * which membership is in play. Requiring a `TenantContext` here would
     * require the answer as an argument.
     *
     * Isolation is structural instead — every query is keyed on a
     * `membershipId`, which belongs to exactly one organization, so a result
     * cannot span tenants however the caller asks. The platform query is
     * keyed on the user and is scoped by `roles.scope = 'PLATFORM'`.
     */
    join(
      'modules',
      'identity',
      'authorization',
      'domain',
      'permission.repository.ts',
    ),
    join(
      'modules',
      'identity',
      'authorization',
      'infrastructure',
      'prisma-permission.repository.ts',
    ),
    // mfa_methods and mfa_recovery_codes — PLATFORM (§3, rows 18 and 19).
    // A second factor belongs to a person, not to one of their organizations:
    // scoping it per tenant would mean enrolling an authenticator once per
    // membership, and MFA gates login, which runs before any tenant is known.
    join('modules', 'identity', 'mfa', 'domain', 'mfa.repository.ts'),
    join(
      'modules',
      'identity',
      'mfa',
      'infrastructure',
      'prisma-mfa.repository.ts',
    ),
  ]);

  const allRepositories = sourceFiles
    .filter((file) => file.endsWith('.repository.ts'))
    .map((file) => relative(sourceRoot, file));

  const repositoryFiles = allRepositories
    .filter((file) => !NON_TENANT_REPOSITORIES.has(file))
    .map((file) => join(sourceRoot, file));

  /**
   * A public method at one level of class-body indentation: not `private` or
   * `protected`, not the constructor.
   */
  const publicMethod =
    /^ {2}(?!private |protected |constructor|return |if |for |while |switch |catch |\/)(?:async )?(\w+)\s*\(([^)]*)\)/gm;

  function offendingMethods(filePath: string): string[] {
    const source = executableCodeOf(read(filePath));
    const offenders: string[] = [];

    for (const match of source.matchAll(publicMethod)) {
      const name = match[1];
      const parameters = match[2];

      if (name === undefined || parameters === undefined) continue;

      // Lifecycle hooks belong to Nest, not to a caller holding a context.
      if (name.startsWith('onModule') || name.startsWith('onApplication')) {
        continue;
      }

      if (!/^\s*\w+\s*:\s*TenantContext\b/.test(parameters)) {
        offenders.push(`${relative(sourceRoot, filePath)}#${name}`);
      }
    }

    return offenders;
  }

  it('has no repository method missing the context', () => {
    const offenders = repositoryFiles.flatMap(offendingMethods);

    expect(offenders).toEqual([]);
  });

  /**
   * Guards the guard. Every exemption must name a repository that actually
   * exists — an entry left behind after a rename would silently exempt
   * nothing while reading as though it still exempted something.
   */
  it('exempts only repositories that exist', () => {
    for (const exempt of NON_TENANT_REPOSITORIES) {
      expect(allRepositories).toContain(exempt);
    }
  });
});

/**
 * Rule 3 — ADR-0003 §3, MODULE_DEPENDENCY_MAP.md §6.3.
 *
 * `$unscoped` is reserved for platform operations. The allow-list holds files
 * rather than call sites, because a file is what a reviewer looks at, and
 * adding one is a visible line in a diff — which is the entire point of the
 * escape hatch being explicit.
 */
describe('$unscoped stays on its allow-list', () => {
  const ALLOWED = new Set([
    // Defines it.
    join('infrastructure', 'database', 'tenant-scope.extension.ts'),
    /**
     * "Which organizations do I belong to" and "may I switch into this one"
     * both span organizations by construction — the first *is* the set of
     * them, and the second targets one the session is deliberately not scoped
     * to yet. Filtering on the current organization would make switching away
     * from it impossible (EVT-033).
     *
     * Safe because both queries filter on `userId`: the rows are the caller's
     * own memberships, so no client-supplied organization id can widen the
     * result.
     */
    join(
      'modules',
      'organizations',
      'infrastructure',
      'prisma-organization.repository.ts',
    ),
    /**
     * `roles` is a global reference table with no `organization_id` at all
     * (EVT-044). Reading the catalogue to resolve a role code cannot be scoped
     * to a tenant, and the scope filter that matters — `ORGANIZATION` only —
     * is in the same WHERE clause, which is what stops a PLATFORM role from
     * being assigned through the organization API.
     */
    join(
      'modules',
      'organizations',
      'infrastructure',
      'prisma-member.repository.ts',
    ),
    /**
     * Invitation acceptance happens before any session exists (EVT-043), so
     * there is no organization to scope on — the guard is right to stop the
     * query, and this is the explicit, logged exemption rather than a flag
     * that could outlive the operation.
     *
     * Three call sites, each narrow. Two resolve the invitation and the
     * account behind the invited address, keyed on the token hash and on the
     * normalized email the invitation itself carries — never on anything the
     * caller chose. The third wraps the acceptance transaction, which must
     * write a membership *into* the organization the invitation names, and so
     * cannot be filtered by a context that does not exist yet.
     *
     * A fourth reads `roles`, a global reference table with no
     * `organization_id`.
     */
    join(
      'modules',
      'organizations',
      'infrastructure',
      'prisma-invitation.repository.ts',
    ),
  ]);

  it('has no caller outside the allow-list', () => {
    const unexpected = sourceFiles
      .filter((file) => /\$unscoped\s*\(/.test(executableCodeOf(read(file))))
      .map((file) => relative(sourceRoot, file))
      .filter((file) => !ALLOWED.has(file));

    expect(unexpected).toEqual([]);
  });
});

/**
 * Rule 4 — the structural half, and what makes the other three matter.
 *
 * `$extends` returns a new client and leaves the original fully working, so
 * an injectable unguarded client is a way around every rule above.
 */
describe('the unguarded client is not reachable', () => {
  const databaseRoot = join(sourceRoot, 'infrastructure', 'database');

  it('PrismaModule does not export PrismaService', () => {
    const module = executableCodeOf(
      read(join(databaseRoot, 'prisma.module.ts')),
    );
    const moduleExports = /exports:\s*\[([^\]]*)\]/.exec(module)?.[1] ?? '';

    expect(moduleExports).not.toContain('PrismaService');
    expect(moduleExports).toContain('TENANT_SCOPED_PRISMA');
  });

  it('nothing outside infrastructure/database injects PrismaService', () => {
    const offenders = sourceFiles
      .filter((file) => !file.startsWith(databaseRoot))
      .filter((file) =>
        /:\s*PrismaService\b/.test(executableCodeOf(read(file))),
      )
      .map((file) => relative(sourceRoot, file));

    expect(offenders).toEqual([]);
  });
});
