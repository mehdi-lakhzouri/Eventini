import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

/**
 * Où un événement de sécurité a le droit d'être émis — EVT-077.
 *
 * ## La règle, et la raison qu'elle protège
 *
 * `AuditRecorder.record` **exige** la transaction de l'appelant en premier
 * paramètre : une entrée d'audit doit tomber avec le changement qu'elle
 * décrit. C'est pour ça qu'elle s'écrit depuis un repository, à l'intérieur de
 * la transaction.
 *
 * `SecurityEventRecorder` est l'exact inverse, et la symétrie est le piège :
 * les deux se ressemblent assez pour qu'on place le second comme le premier.
 * Or un événement écrit dans la transaction de l'appelant disparaîtrait avec
 * un rollback — donc exactement dans les cas où il compte, puisque
 * `LOGIN_FAILED`, `TENANT_ACCESS_DENIED` et `ROLE_ESCALATION_ATTEMPTED` sont
 * émis quand rien n'est commité.
 *
 * D'où : le recorder s'appelle depuis un **use case**, après que le repository
 * a rendu la main. Jamais depuis un repository.
 *
 * Le test lit l'arbre des sources plutôt qu'un graphe produit par un outil :
 * pas de dépendance de plus, et l'échec nomme le fichier — ce dont on a besoin
 * pour agir.
 */
const sourceRoot = resolve(__dirname, '..');

const RECORDER = 'SecurityEventRecorder';

/**
 * `infrastructure/` d'un module métier, là où vivent les repositories.
 *
 * Le module `security-events` lui-même est évidemment hors périmètre : c'est
 * son `infrastructure/` qui contient l'adaptateur Prisma du recorder.
 */
const SECURITY_EVENTS_MODULE = join(
  sourceRoot,
  'modules',
  'identity',
  'security-events',
);

function listTypeScriptFiles(directory: string): string[] {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory).flatMap((entry) => {
    const fullPath = join(directory, entry);

    if (statSync(fullPath).isDirectory()) {
      return entry === 'generated' ? [] : listTypeScriptFiles(fullPath);
    }

    return fullPath.endsWith('.ts') && !fullPath.endsWith('.spec.ts')
      ? [fullPath]
      : [];
  });
}

function isInside(child: string, parent: string): boolean {
  const fromParent = relative(parent, child);

  return (
    fromParent.length > 0 &&
    !fromParent.startsWith('..') &&
    !fromParent.startsWith(sep)
  );
}

describe('security event emission', () => {
  const repositoryFiles = listTypeScriptFiles(join(sourceRoot, 'modules'))
    .filter((file) => file.split(sep).includes('infrastructure'))
    .filter((file) => !isInside(file, SECURITY_EVENTS_MODULE));

  it('finds the repositories it is meant to be checking', () => {
    // Sans cette assertion, un changement d'arborescence rendrait le test
    // vert en ne vérifiant plus rien.
    expect(repositoryFiles.length).toBeGreaterThan(5);
  });

  /*
    Un repository écrit dans la transaction de l'appelant : l'événement y
    disparaîtrait au rollback. Émettre depuis le use case, après le commit.
  */
  it('never reaches SecurityEventRecorder from a repository', () => {
    const offenders = repositoryFiles.filter((file) =>
      readFileSync(file, 'utf8').includes(RECORDER),
    );

    expect(offenders.map((file) => relative(sourceRoot, file))).toEqual([]);
  });

  /**
   * Le pendant : l'audit, lui, ne doit pas remonter dans les use cases, sans
   * quoi il perdrait la transaction qui fait toute sa valeur.
   */
  it('never reaches AuditRecorder from a use case', () => {
    const useCaseFiles = listTypeScriptFiles(join(sourceRoot, 'modules'))
      .filter((file) => file.endsWith('.use-case.ts'))
      .filter((file) => readFileSync(file, 'utf8').includes('AuditRecorder'));

    // Un use case écrirait l'audit hors de la transaction du changement : un
    // échec entre les deux laisserait un changement sans trace.
    expect(useCaseFiles.map((file) => relative(sourceRoot, file))).toEqual([]);
  });
});
