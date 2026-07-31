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
    join(
      'modules',
      'identity',
      'sessions',
      'infrastructure',
      'prisma-session.repository.ts',
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
    /^ {2}(?!private |protected |constructor|\/)(?:async )?(\w+)\s*\(([^)]*)\)/gm;

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
