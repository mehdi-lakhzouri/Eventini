# Sprint 01 — Stabilisation du dépôt

> [← Index des sprints](../SPRINT_PLAN.md) · [Feuille de route](../IMPLEMENTATION_ROADMAP.md) · [Sprint 02 →](../sprint-02/README.md)

| | |
|---|---|
| **Tickets** | EVT-001 → EVT-007, **EVT-074** |
| **Prérequis** | aucun |
| **Migrations** | aucune |
| **Jalon** | — |

---

## Objectif

Obtenir un dépôt qui **compile**, dont l'historique git est **réel**, et dont un clone neuf **démarre**.

Aucune feature métier. Ce sprint ne produit rien de visible pour un utilisateur — il produit la capacité de vérifier quoi que ce soit par la suite. On ne construit pas sur un dépôt qui ne compile pas (invariant **O-1**).

## Critère de sortie

- `lint`, `typecheck` et `build` verts sur **backend et frontend** ;
- `web/.git` supprimé, `master` et `develop` créées et poussées, contenant **réellement** les sources frontend ;
- `docker compose up` fonctionnel depuis un clone neuf.

---

## Tickets

| # | Titre | Bloquant |
|---|---|---|
| [EVT-001](#evt-001) | Assainir le dépôt git | 🔴 **oui** |
| [EVT-002](#evt-002) | Strictness TypeScript | |
| [EVT-003](#evt-003) | Réparer les imports frontend cassés | 🔴 **oui** |
| [EVT-004](#evt-004) | Nettoyer les structures mortes | |
| [EVT-005](#evt-005) | Configuration de test et scripts npm | |
| [EVT-006](#evt-006) | Fondations CI et `.github/` | |
| [EVT-007](#evt-007) | `docker/.env.example` | ✅ partiellement fait |
| [EVT-074](#evt-074) | Remédiation des vulnérabilités de dépendances | |

---

## EVT-001 — Assainir le dépôt git
<a id="evt-001"></a>

```
Branche  chore/EVT-001-repository-hygiene
Commit   chore(infra): remove nested web git repository and create initial commit
PR       [EVT-001] chore(infra): repository hygiene
```

> ✅ **Fait le 30 juillet 2026** — `web/.git` supprimé, commit initial sur `master`, `develop` créée, les deux poussées, **protection de branche appliquée et vérifiée** (11 checks requis, push direct rejeté). Voir [`GIT_STRATEGY.md` §7](../../operations/GIT_STRATEGY.md).

**Scope** — supprimer `web/.git` ; commit initial sur `master` ; créer `develop` ; protéger les deux branches selon [`GIT_STRATEGY.md` §7](../../operations/GIT_STRATEGY.md).

**Hors scope** — reconstruction d'historique, contenu de `.github/` (EVT-006).

### 🔴 Pourquoi c'est le ticket le plus important du projet

`web/.git` est un **dépôt git distinct**, avec un seul commit (`Initial commit from Create Next App`) et aucun remote. Le dépôt racine a **zéro commit** et voit `web/` comme non suivi.

Committer `web/` en l'état crée un **lien de sous-module (gitlink)** pointant vers un dépôt qui n'existe nulle part ailleurs. Concrètement : le push réussit, GitHub affiche un dossier `web` cliquable et vide, et **aucune ligne de code frontend n'est réellement versionnée**. La perte est silencieuse.

### Procédure

```bash
# 1. Vérifier ce que le dépôt imbriqué contient et qu'il n'a rien d'unique
cd web && git log --oneline && git status && cd ..

# 2. Supprimer le dépôt imbriqué (le code source reste sur le disque)
rm -rf web/.git

# 3. Vérifier que web/ est bien vu comme des fichiers ordinaires
git add -A --dry-run | grep '^add .web/src' | head

# 4. Commit initial sur master, puis création de develop
git add -A
git commit -m "chore(repo): initial commit"
git branch develop
git push -u origin master
git push -u origin develop
```

**Checks** — `secret-scan`

**Vérification** — `git ls-files web/src | wc -l` retourne un nombre **> 0**. Si le résultat est `0` ou `1`, le gitlink est toujours là.

**Attention** — vérifier avant le commit que `docker/.env` n'est pas suivi : il contient de vrais mots de passe. Le `.gitignore` racine le couvre, mais un `git add -f` accidentel passerait outre.

---

## EVT-002 — Strictness TypeScript
<a id="evt-002"></a>

```
Branche  chore/EVT-002-strict-typescript
Commit   chore(config): enable strict TypeScript and forbid explicit any
```

**Scope**

| Fichier | Changement |
|---|---|
| `backend/tsconfig.json` | `strict: true`, `noImplicitAny: true`, `strictBindCallApply: true` |
| `backend/eslint.config.mjs` | `@typescript-eslint/no-explicit-any: 'error'`, `no-floating-promises: 'error'` |
| `web/eslint.config.mjs` | enregistrer `@tanstack/eslint-plugin-query` (installé, non branché) |

**État actuel** — `noImplicitAny: false`, `strictBindCallApply: false`, et ESLint a `no-explicit-any: 'off'`.

**Pourquoi maintenant** — activer la strictness **avant** d'écrire le code de sécurité. Un `any` implicite dans un guard d'autorisation compile silencieusement et supprime toute vérification de type sur la décision d'accès. L'activer au sprint 06 imposerait de reprendre tout le code écrit entre-temps.

**Checks** — `lint` `typecheck` `build`

**Vérification** — `npx tsc --noEmit` sans erreur sur les deux projets.

---

## EVT-003 — Réparer les imports frontend cassés
<a id="evt-003"></a>

```
Branche  fix/EVT-003-frontend-broken-imports
Commit   fix(web): add missing types barrel and mount AppProviders
```

**Défauts corrigés** — F-1, F-2 et le cycle de F-11 de [`FRONTEND_ARCHITECTURE.md`](../../architecture/FRONTEND_ARCHITECTURE.md).

### F-1 — le barrel `types` n'existe pas

`web/src/features/authentication/types/` contient `authentication.types.ts`, `permission.types.ts`, `session.types.ts` — **et aucun `index.ts`**. Sept fichiers font `from "../types"` et ne résolvent pas (TS2307) :

```
api/authentication.api.ts      api/mfa.api.ts        api/password.api.ts
api/sessions.api.ts            components/auth-guard.tsx
hooks/use-permissions.ts       utils/authentication.utils.ts
```

Créer `types/index.ts` réexportant les trois fichiers.

### F-2 — `AppProviders` n'est monté nulle part

`providers/app-providers.tsx` compose correctement `InternationalizationProvider > ThemeProvider > QueryProvider`, et **aucun fichier ne l'importe**. `app/layout.tsx` rend `<body>{children}</body>` sans wrapper.

Conséquence : le premier `useQuery` monté lève **« No QueryClient set »**. Toutes les pages d'authentification planteraient dès qu'on remplit leurs formulaires.

### Cycle d'imports

`lib/permissions/permission-checker.ts` importe `Permission` depuis le barrel `@/features/authentication`, qui réexporte `hooks/use-permissions.ts`, qui réimporte `hasPermission` depuis `permission-checker`. Corriger en important le type directement depuis `features/authentication/types/permission.types`.

**Checks** — `lint` `typecheck` `build`

**Vérification** — `npx tsc --noEmit` passe ; `npm run build` aboutit ; une page montant `useCurrentUser()` ne plante pas.

---

## EVT-004 — Nettoyer les structures mortes
<a id="evt-004"></a>

> ✅ **Fait le 30 juillet 2026.**

```
Branche  chore/EVT-004-remove-dead-structures
Commit   chore(repo): remove duplicated and dead directory structures
```

**Scope**

| Supprimé | Pourquoi | Résultat |
|---|---|---|
| `web/src/shared/` | 7 répertoires de `.gitkeep` doublant conceptuellement `src/lib` + `src/features` | 7 fichiers retirés |
| `backend/src/application/`, `src/domain/`, `src/presentation/` | squelette DDD parallèle non documenté, doublant la découpe par module | **jamais suivis par git** — 0 fichier dans chacun, confirmé avant suppression ; retirés du disque quand même |
| `backend/src/shared/` | 6 répertoires ne contenant que des `.gitkeep` | 6 fichiers retirés |
| `web/tsconfig.sidebar-test.tsbuildinfo` | 119 Ko orphelins — aucun `tsconfig.sidebar-test.json` n'existe | supprimé (déjà gitignoré, donc invisible en diff) |
| `backend/dist/` | build committé en arborescence | **vérifié non suivi par git** (0 fichier, déjà gitignoré) — aucune action nécessaire, la mention initiale était inexacte |

**Décision prise** — `(public)` et `(scanner)` ne produisaient **aucune route** (ni `layout.tsx` ni `page.tsx`), seulement `error.tsx`, `loading.tsx` et 8 `.gitkeep`. **Supprimés plutôt que stubbés** : fabriquer des pages maintenant aurait anticipé du contenu non scopé (`(scanner)` n'a de sens qu'au sprint 12, `(public)` n'est même pas planifié). Aucune référence externe (`grep` sur `web/src`) ne pointait vers ces groupes. Ils seront recréés avec du contenu réel quand leur sprint arrive.

**Pourquoi** — deux taxonomies concurrentes garantissent que le code finira réparti au hasard entre les deux, et qu'aucune ne sera complète. Un groupe de routes fantôme induit en erreur de la même façon.

**Documentation mise à jour dans le même changement** — `FRONTEND_ARCHITECTURE.md` (F-8, F-10, F-12 marqués résolus), `BACKEND_ARCHITECTURE.md` (`src/shared/*` et le squelette DDD marqués résolus), `SYSTEM_ARCHITECTURE.md` (§3.3 et §3.5 — **B-1 est également marqué résolu ici**, ayant été traité par EVT-001 avant ce ticket), `IDEMPOTENCY_AND_CONCURRENCY.md` (référence à `shared/idempotency/.gitkeep` mise à jour). C'était un rattrapage : EVT-003 avait corrigé F-1/F-2 sans mettre à jour ces tableaux, contrairement à la règle de `PROJECT_DOCUMENTATION_INDEX.md` §8.

**Checks** — `lint` `typecheck` `build` `test` sur les deux projets, plus `arch` (le test `modularity.spec.ts` gère déjà un `src/shared` absent via `existsSync`, aucune modification requise)

---

## EVT-005 — Configuration de test et scripts npm
<a id="evt-005"></a>

```
Branche  chore/EVT-005-test-tooling
Commit   chore(ci): configure vitest, playwright and missing npm scripts
```

**Scope** — `web/vitest.config.ts`, `web/playwright.config.ts`, un test de fumée par outil pour prouver qu'ils tournent.

**Scripts npm à ajouter**

| Projet | Scripts |
|---|---|
| `web` | `test`, `test:e2e`, `type-check`, `format` |
| `backend` | `typecheck`, `test:integration` |

**État actuel** — `vitest`, `@playwright/test` et `@testing-library/*` sont installés **sans configuration, sans test, sans script**. `web/package.json` n'a que `dev`, `build`, `start`, `lint`.

**Vérification** — `npm test` et `npm run test:e2e` s'exécutent et passent sur le test de fumée.

---

## EVT-006 — Fondations CI et `.github/`
<a id="evt-006"></a>

```
Branche  chore/EVT-006-github-ci
Commit   chore(ci): add workflows, PR template and issue templates
```

> ✅ **Les fichiers existent déjà** — écrits avec la documentation. Ce ticket les **active** : brancher les checks requis sur la protection de branche et vérifier que chaque job s'exécute réellement.

| Fichier | Rôle |
|---|---|
| [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml) | lint, typecheck, tests, build, migrations, Lua, docs |
| [`.github/workflows/security.yml`](../../../.github/workflows/security.yml) | gitleaks, audit, motifs interdits, CodeQL |
| [`.github/pull_request_template.md`](../../../.github/pull_request_template.md) | DoD + impact sécurité + tests négatifs |
| [`.github/ISSUE_TEMPLATE/`](../../../.github/ISSUE_TEMPLATE/) | feature, bug, security |
| [`.github/CODEOWNERS`](../../../.github/CODEOWNERS) | revue obligatoire sur les chemins sensibles |

**Règle** — un job non encore activable reste en `continue-on-error` avec un `TODO` nommant son sprint de bascule. **Un badge vert qui ment est pire que pas de badge.**

Le job `lua` et le job `docs` sont **bloquants dès maintenant** : leurs cibles existent déjà.

**Checks à rendre bloquants à la fin de ce sprint** — `lint`, `typecheck`, `test:unit`, `build`, `secret-scan`.

---

## EVT-007 — `docker/.env.example`
<a id="evt-007"></a>

> ✅ **Partiellement fait le 30 juillet 2026 à 16:36** — le fichier contient désormais les 9 variables avec des valeurs factices. Il était à 0 octet lors de l'audit du matin.

```
Branche  fix/EVT-007-docker-env-example
Commit   fix(infra): document docker bootstrap and verify clean-clone startup
```

**Scope restant** — vérifier qu'un clone neuf démarre effectivement ; documenter la procédure dans `docker/README.md` ; confirmer que les valeurs sont explicitement factices.

**Pourquoi c'était bloquant** — `docker/.env.example` est le **seul** fichier que la règle `!.env.example` du `.gitignore` laisse passer. Vide, un contributeur clonant le dépôt n'avait aucun moyen de savoir quelles variables définir, et `docker compose up` échouait sur `${POSTGRES_USER}` non défini.

**Vérification**

```bash
git clone <repo> /tmp/eventini-fresh && cd /tmp/eventini-fresh/docker
cp .env.example .env
docker compose up -d
docker compose ps          # les 3 conteneurs doivent devenir "healthy"
```

---

## EVT-074 — Remédiation des vulnérabilités de dépendances
<a id="evt-074"></a>

> ✅ **Fait le 30 juillet 2026.** Toutes les advisories atteignables depuis une dépendance **de production** sont corrigées et **vérifiées fonctionnellement**, pas seulement installées. Ce qui reste est confiné à de l'outillage de développement sans correctif disponible, documenté précisément plutôt que masqué.

```
Branche  chore/EVT-074-dependency-remediation
Commit   chore(deps): resolve production advisories with scoped overrides
```

**Découvert le 30 juillet 2026** par le premier passage de CI. Documenté initialement comme risque accepté **RA-10** dans [`THREAT_MODEL.md` §5](../../security/THREAT_MODEL.md) ; RA-10 est désormais scindé en trois entrées précises (RA-10/11/12) reflétant ce qui est réellement corrigé contre ce qui ne l'est pas et pourquoi.

### Ce qui a été corrigé

| Chaîne | Advisory | Chemin | Mécanisme |
|---|---|---|---|
| `@nestjs/swagger → js-yaml@5.2.1` | DoS parsing exponentiel (`GHSA-pm4m-ph32-ghv5`) | **production** — génération OpenAPI | `overrides.js-yaml = "5.2.2"` |
| `exceljs → archiver → readdir-glob → minimatch → brace-expansion@2.1.2` | DoS expansion non bornée (`GHSA-mh99-v99m-4gvg`) | **production** — imports/exports participants (sprint 10) | override **scopé** au chemin exact `exceljs.archiver.readdir-glob.minimatch.brace-expansion` |
| `exceljs → uuid@8.3.2` | dépassement de tampon v3/v5/v6 (`GHSA-w5hq-g745-h8pq`, modérée) | **production** | override scopé `exceljs.uuid = "11.1.1"` |
| `next → postcss@8.4.31` (web) | XSS + lecture de fichier arbitraire (`GHSA-qx2v-qp2m-jg93`, `GHSA-6g55-p6wh-862q`, `GHSA-r28c-9q8g-f849`) | **production** — pipeline CSS du build | `overrides.postcss = "8.5.25"` — même version déjà utilisée avec succès ailleurs dans l'arbre |

### 🔴 Pourquoi un override global a d'abord cassé ESLint

La première tentative forçait `brace-expansion` à `^5.0.9` **globalement**. `npm run lint` a immédiatement échoué : `minimatch@3.1.5`, embarqué par `@eslint/eslintrc`, déclare `brace-expansion@^1.1.7` et son code interne ne comprend pas la forme du module à partir de la version 2. C'est ESLint qui a détecté l'incompatibilité, pas une supposition a priori.

La correction a été un override **scopé au chemin exact** (`exceljs.archiver.readdir-glob.minimatch.brace-expansion`) plutôt que global — la seule installation de `brace-expansion` réellement atteinte depuis une dépendance de production passe par ce chemin unique.

### Chaque correctif a été exercé, pas seulement installé

```js
// backend : construit un classeur, ajoute une mise en forme conditionnelle
// (le seul point d'appel réel de uuid.v4() dans exceljs), l'écrit, le relit
const workbook = new ExcelJS.Workbook();
sheet.addConditionalFormatting({ /* ... */ });
const buffer = await workbook.xlsx.writeBuffer();
await readBack.xlsx.load(buffer);   // round-trip OK
```

```
# web : le build Next.js exerce réellement le pipeline postcss patché
$ npm run build
✓ Compiled successfully
233 647 bytes de CSS Tailwind réel généré
```

### Ce qui reste, et pourquoi c'est correctement documenté plutôt que corrigé

| Advisory | Portée | Pourquoi non corrigé | Détail |
|---|---|---|---|
| `brace-expansion` dans `minimatch@3.1.5` (ESLint) et `minimatch@9.0.9` (Jest) | **dev uniquement** | Aucune version corrigée n'existe sur ces lignes majeures — le correctif était une réécriture, jamais rétroporté. Bumper ESLint/Jest est une rupture hors périmètre | RA-10 |
| `sharp` (web, via `next`) | **production, mais optionnelle** | `next` déclare `^0.34.5` — en caret sur une version `0.x`, ceci **exclut structurellement** le correctif `0.35.x`. Bindings natifs (libvips), non certifié par Next.js | RA-11 |
| `@hono/node-server` (web, via `shadcn`) | **dev uniquement** | Atteint uniquement par la sous-commande MCP optionnelle du CLI `shadcn`, jamais invoquée | RA-12 |

### Un artefact de `npm audit` à connaître

Après correction, `npm audit --audit-level=high` **continue de citer** `archiver`, `glob`, `minimatch`, `exceljs`, `readdir-glob`, `rimraf`, `zip-stream` comme « high ». Ce n'est pas un signe d'échec : `npm audit` établit son rapport à partir de la **plage déclarée** dans le `package.json` de chaque paquet intermédiaire, pas de la version réellement résolue par `overrides`. Vérifié par inspection directe du disque :

```bash
$ find node_modules -name brace-expansion
  5.0.9   node_modules/brace-expansion                                    # patché, hoisté
  1.1.18  node_modules/minimatch/node_modules/brace-expansion             # ESLint, dev, sans correctif possible
  2.1.4   node_modules/@jest/reporters/node_modules/brace-expansion       # Jest, dev, idem ×3
```

Une seule copie non patchée par chemin de production, et elle n'existe pas — le résultat visible de `npm audit` seul aurait été trompeur dans les deux sens sans cette vérification.

### Gate CI — remplacé, pas assoupli

L'étape « high, tracked, not blocking » avec `continue-on-error` est remplacée par une **liste blanche d'identifiants GHSA exacts**, testée localement pour prouver qu'elle bloque bien une advisory non listée (pas seulement qu'elle laisse passer les connues) :

```
backend  GHSA-mh99-v99m-4gvg
web      GHSA-mh99-v99m-4gvg GHSA-f88m-g3jw-g9cj GHSA-frvp-7c67-39w9
```

Toute advisory `high`/`critical` en dehors de cette liste **fait échouer le build**.

### Vérification

- `npm audit --audit-level=critical` → `0` sur les deux projets (inchangé, déjà vrai avant ce ticket) ;
- allowlist Python testée en local : `0` advisory inattendue sur les deux projets **et** détection positive prouvée sur une advisory simulée hors liste ;
- `exceljs` : test fonctionnel réel (écriture + relecture + mise en forme conditionnelle) ;
- web : build réel, 233 Ko de CSS généré, 13 routes (inchangé) ;
- lint, typecheck, build, test : verts sur les deux projets.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| `rm -rf web/.git` exécuté sans vérifier son contenu | EVT-001 étape 1 : inspecter `git log` avant |
| `docker/.env` committé avec de vrais mots de passe | `secret-scan` bloquant + job « no `.env` tracked » |
| La strictness TypeScript révèle beaucoup d'erreurs d'un coup | Le code réel est quasi inexistant : 3 fichiers avec de la logique. C'est précisément pourquoi on le fait **maintenant** |
| ~~`(public)` / `(scanner)` laissés en l'état « pour plus tard »~~ | ✅ Résolu — supprimés par EVT-004, recréés à leur sprint réel |
