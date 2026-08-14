import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';

const sourceRoot = resolve(__dirname, '..');
const modulesRoot = join(sourceRoot, 'modules');
const sharedRoot = join(sourceRoot, 'shared');
const importPattern =
  /(?:import|export)\s+(?:type\s+)?(?:[^'"]*from\s+)?['"]([^'"]+)['"]|require\(['"]([^'"]+)['"]\)/g;

function listTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return listTypeScriptFiles(fullPath);
    }

    return fullPath.endsWith('.ts') && !fullPath.endsWith('.spec.ts')
      ? [fullPath]
      : [];
  });
}

function isInside(child: string, parent: string): boolean {
  const pathFromParent = relative(parent, child);

  return (
    pathFromParent.length > 0 &&
    !pathFromParent.startsWith('..') &&
    !pathFromParent.startsWith(sep)
  );
}

function resolveInternalImport(
  filePath: string,
  importPath: string,
): string | null {
  if (importPath.startsWith('.')) {
    return normalize(resolve(dirname(filePath), importPath));
  }

  if (importPath.startsWith('src/')) {
    return normalize(resolve(sourceRoot, '..', importPath));
  }

  return null;
}

function isPublicModuleImport(
  resolvedImport: string,
  moduleRoot: string,
): boolean {
  return (
    resolvedImport === moduleRoot ||
    resolvedImport === join(moduleRoot, 'index') ||
    resolvedImport === join(moduleRoot, 'index.ts')
  );
}

describe('backend module boundaries', () => {
  it('blocks direct imports into another module internals', () => {
    const moduleNames = readdirSync(modulesRoot).filter((entry) =>
      statSync(join(modulesRoot, entry)).isDirectory(),
    );

    const violations = moduleNames.flatMap((sourceModule) => {
      const sourceModuleRoot = join(modulesRoot, sourceModule);
      const files = listTypeScriptFiles(sourceModuleRoot);

      return files.flatMap((filePath) => {
        const content = readFileSync(filePath, 'utf8');
        const matches = [...content.matchAll(importPattern)];

        return matches.flatMap((match) => {
          // The pattern has two alternative capture groups; exactly one fills
          // on any successful match. Skipping when neither did keeps this
          // honest instead of asserting a non-null the compiler cannot verify.
          const importPath = match[1] ?? match[2];
          if (importPath === undefined) {
            return [];
          }

          const resolvedImport = resolveInternalImport(filePath, importPath);

          if (resolvedImport === null) {
            return [];
          }

          return moduleNames.flatMap((targetModule) => {
            if (targetModule === sourceModule) {
              return [];
            }

            const targetModuleRoot = join(modulesRoot, targetModule);
            const reachesTarget =
              resolvedImport === targetModuleRoot ||
              isInside(resolvedImport, targetModuleRoot);

            if (
              reachesTarget &&
              !isPublicModuleImport(resolvedImport, targetModuleRoot)
            ) {
              return [
                `${relative(sourceRoot, filePath)} imports private module path "${importPath}"`,
              ];
            }

            return [];
          });
        });
      });
    });

    expect(violations).toEqual([]);
  });

  it('keeps shared independent from modules', () => {
    const violations = listTypeScriptFiles(sharedRoot).flatMap((filePath) => {
      const content = readFileSync(filePath, 'utf8');
      const matches = [...content.matchAll(importPattern)];

      return matches.flatMap((match) => {
        const importPath = match[1] ?? match[2];
        if (importPath === undefined) {
          return [];
        }

        const resolvedImport = resolveInternalImport(filePath, importPath);

        if (resolvedImport !== null && isInside(resolvedImport, modulesRoot)) {
          return [
            `${relative(sourceRoot, filePath)} imports module path "${importPath}"`,
          ];
        }

        return [];
      });
    });

    expect(violations).toEqual([]);
  });
});
