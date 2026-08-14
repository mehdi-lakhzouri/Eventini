import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

/**
 * The nine forbidden edges of MODULE_DEPENDENCY_MAP.md §5, enforced.
 *
 * These held three `it.todo` until EVT-036. A todo passes, so the suite stayed
 * green while the rules it names went unchecked — which is the shape a claim
 * takes when nobody has verified it. Every rule below is one someone can break
 * by accident, and two of them were already broken when this was written.
 *
 * The checks read the source tree rather than a dependency graph produced by a
 * tool: no extra dependency, and the failure names the file and the import,
 * which is what a developer needs to act on.
 */
const sourceRoot = resolve(__dirname, '..');
const modulesRoot = join(sourceRoot, 'modules');

const IMPORT_PATTERN =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g;

function listTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);

    if (statSync(fullPath).isDirectory()) {
      // The generated Prisma client is not ours to hold to these rules.
      return entry === 'generated' ? [] : listTypeScriptFiles(fullPath);
    }

    return fullPath.endsWith('.ts') && !fullPath.endsWith('.spec.ts')
      ? [fullPath]
      : [];
  });
}

const allFiles = listTypeScriptFiles(sourceRoot);

function isInside(child: string, parent: string): boolean {
  const fromParent = relative(parent, child);

  return (
    fromParent.length > 0 &&
    !fromParent.startsWith('..') &&
    !fromParent.startsWith(sep)
  );
}

/** Every import specifier in a file, comments and strings included. */
function importsOf(filePath: string): string[] {
  const source = readFileSync(filePath, 'utf8');
  const found: string[] = [];

  for (const match of source.matchAll(IMPORT_PATTERN)) {
    const specifier = match[1] ?? match[2];

    if (specifier !== undefined) {
      found.push(specifier);
    }
  }

  return found;
}

/** Resolves a relative or `src/`-rooted specifier; returns null for a package. */
function resolveInternal(filePath: string, specifier: string): string | null {
  if (specifier.startsWith('.')) {
    return normalize(resolve(dirname(filePath), specifier));
  }

  if (specifier.startsWith('src/')) {
    return normalize(resolve(sourceRoot, '..', specifier));
  }

  return null;
}

const show = (filePath: string): string => relative(sourceRoot, filePath);

/**
 * Files under `root` whose imports reach `forbiddenRoot`, reported as
 * "file -> specifier" so the failure names both ends of the edge.
 */
function crossings(root: string, forbiddenRoot: string): string[] {
  return allFiles
    .filter((file) => isInside(file, root))
    .flatMap((file) =>
      importsOf(file)
        .map((specifier) => ({
          specifier,
          resolved: resolveInternal(file, specifier),
        }))
        .filter(
          ({ resolved }) =>
            resolved !== null &&
            (resolved === forbiddenRoot || isInside(resolved, forbiddenRoot)),
        )
        .map(({ specifier }) => `${show(file)} -> ${specifier}`),
    );
}

describe('forbidden backend imports', () => {
  /**
   * The foundation cannot depend on what is built on it. `common/` and
   * `config/` importing a feature module inverts the hierarchy and makes the
   * base untestable on its own — and it is an easy mistake, because a shared
   * helper often *wants* a domain type.
   *
   * `@Public()` lives in `common/decorators` for exactly this reason: it began
   * in `identity/authorization`, where `infrastructure/` could not reach it.
   */
  it.each([['common'], ['config']])(
    'blocks %s from importing modules',
    (base) => {
      expect(crossings(join(sourceRoot, base), modulesRoot)).toEqual([]);
    },
  );

  /** Infrastructure knows about databases and transports, not about the business. */
  it('blocks infrastructure from importing modules', () => {
    expect(crossings(join(sourceRoot, 'infrastructure'), modulesRoot)).toEqual(
      [],
    );
  });

  /**
   * 🔴 A cycle, and one this repository actually created.
   *
   * EVT-035 put `TenantContextGuard` beside the service it calls, which reads
   * naturally and inverts §3's arrow: authorization needs the resolved tenant,
   * the tenant does not need permissions. The guard now lives in
   * `authorization`, which is the side allowed to know both.
   */
  it('blocks tenant-access from importing authorization', () => {
    expect(
      crossings(
        join(modulesRoot, 'identity', 'tenant-access'),
        join(modulesRoot, 'identity', 'authorization'),
      ),
    ).toEqual([]);
  });

  /**
   * Everything depends on `security-events`, so an outgoing dependency from it
   * is a cycle with whatever it reaches.
   */
  it('blocks security-events from importing any other module', () => {
    const securityEvents = join(modulesRoot, 'identity', 'security-events');
    const offenders = allFiles
      .filter((file) => isInside(file, securityEvents))
      .flatMap((file) =>
        importsOf(file)
          .map((specifier) => ({
            specifier,
            resolved: resolveInternal(file, specifier),
          }))
          .filter(
            ({ resolved }) =>
              resolved !== null &&
              isInside(resolved, modulesRoot) &&
              !isInside(resolved, securityEvents),
          )
          .map(({ specifier }) => `${show(file)} -> ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  /**
   * A controller reaching Prisma skips the use case, the repository and the
   * tenant guard in one move — the query then carries no `TenantContext`, and
   * nothing downstream notices.
   */
  it('blocks controllers from importing Prisma directly', () => {
    const offenders = allFiles
      .filter(
        (file) =>
          file.includes(`${sep}controllers${sep}`) ||
          file.endsWith('.controller.ts'),
      )
      .flatMap((file) =>
        importsOf(file)
          .filter(
            (specifier) =>
              specifier === '@prisma/client' ||
              specifier.includes('prisma/generated') ||
              /(^|\/)prisma\.service$/.test(specifier) ||
              specifier.endsWith('prisma.tokens'),
          )
          .map((specifier) => `${show(file)} -> ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  /**
   * The domain layer states rules. A rule that needs Nest to be instantiated,
   * or Prisma to be connected, cannot be tested without standing the framework
   * up — and a rule that is awkward to test is a rule that stops being tested.
   *
   * Abstract repository classes live in `domain/` and name only their own
   * types, which is why the ports are hand-written rather than generated.
   */
  it('blocks domain from importing a framework', () => {
    const frameworks = [
      '@nestjs/',
      '@prisma/client',
      'express',
      'prisma/generated',
    ];

    const offenders = allFiles
      .filter((file) => file.includes(`${sep}domain${sep}`))
      .flatMap((file) =>
        importsOf(file)
          .filter((specifier) =>
            frameworks.some((framework) => specifier.startsWith(framework)),
          )
          .map((specifier) => `${show(file)} -> ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  /**
   * Credentials, token hashes and MFA secrets live behind identity's
   * infrastructure. A feature module reaching in gets at storage it has no
   * business reading, and freezes an implementation detail while doing it.
   */
  it('blocks other modules from reaching identity infrastructure', () => {
    const identityRoot = join(modulesRoot, 'identity');

    const offenders = allFiles
      .filter(
        (file) => isInside(file, modulesRoot) && !isInside(file, identityRoot),
      )
      .flatMap((file) =>
        importsOf(file)
          .map((specifier) => ({
            specifier,
            resolved: resolveInternal(file, specifier),
          }))
          .filter(
            ({ resolved }) =>
              resolved !== null &&
              isInside(resolved, identityRoot) &&
              resolved.includes(`${sep}infrastructure${sep}`),
          )
          .map(({ specifier }) => `${show(file)} -> ${specifier}`),
      );

    expect(offenders).toEqual([]);
  });

  /**
   * A cycle between two feature modules, found by walking the graph rather
   * than by adding `madge`: the edges here are module-to-module, which is the
   * granularity the rule is about, and a file-level cycle inside one module is
   * not what §5 forbids.
   */
  it('has no cycle between feature modules', () => {
    const moduleNames = readdirSync(modulesRoot).filter((entry) =>
      statSync(join(modulesRoot, entry)).isDirectory(),
    );

    const edges = new Map<string, Set<string>>(
      moduleNames.map((name) => [name, new Set<string>()]),
    );

    for (const name of moduleNames) {
      const moduleRoot = join(modulesRoot, name);

      for (const file of allFiles.filter((f) => isInside(f, moduleRoot))) {
        for (const specifier of importsOf(file)) {
          const resolved = resolveInternal(file, specifier);

          if (resolved === null || !isInside(resolved, modulesRoot)) {
            continue;
          }

          const target = relative(modulesRoot, resolved).split(sep)[0];

          if (target !== undefined && target !== name && edges.has(target)) {
            edges.get(name)?.add(target);
          }
        }
      }
    }

    expect(findCycle(edges)).toBeNull();
  });
});

/** The first cycle found, as a readable path, or null. */
function findCycle(edges: ReadonlyMap<string, Set<string>>): string | null {
  const settled = new Set<string>();
  const onStack = new Set<string>();

  const walk = (node: string, path: string[]): string | null => {
    if (onStack.has(node)) {
      return [...path.slice(path.indexOf(node)), node].join(' -> ');
    }

    if (settled.has(node)) {
      return null;
    }

    onStack.add(node);

    for (const next of edges.get(node) ?? []) {
      const cycle = walk(next, [...path, node]);

      if (cycle !== null) {
        return cycle;
      }
    }

    onStack.delete(node);
    settled.add(node);

    return null;
  };

  for (const node of edges.keys()) {
    const cycle = walk(node, []);

    if (cycle !== null) {
      return cycle;
    }
  }

  return null;
}
