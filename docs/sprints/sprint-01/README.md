# Sprint 01 — Stabilisation du dépôt

> [← Index des sprints](../SPRINT_PLAN.md) · [Feuille de route](../IMPLEMENTATION_ROADMAP.md) · [Sprint 02 →](../sprint-02/README.md)

| | |
|---|---|
| **Tickets** | EVT-001 → EVT-007 |
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

---

## EVT-001 — Assainir le dépôt git
<a id="evt-001"></a>

```
Branche  chore/EVT-001-repository-hygiene
Commit   chore(infra): remove nested web git repository and create initial commit
PR       [EVT-001] chore(infra): repository hygiene
```

> ✅ **Fait le 30 juillet 2026** — `web/.git` supprimé, commit initial sur `master`, `develop` créée, les deux poussées. Reste : appliquer les règles de protection de branche dans les paramètres GitHub.

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

```
Branche  chore/EVT-004-remove-dead-structures
Commit   chore(repo): remove duplicated and dead directory structures
```

**Scope**

| À supprimer | Pourquoi |
|---|---|
| `web/src/shared/` | 7 répertoires de `.gitkeep` doublant conceptuellement `src/lib` + `src/features` |
| `backend/src/application/`, `src/domain/`, `src/presentation/` | squelette DDD parallèle non documenté, doublant la découpe par module |
| `backend/src/shared/` | 6 répertoires ne contenant que des `.gitkeep` |
| `web/tsconfig.sidebar-test.tsbuildinfo` | 119 Ko orphelins — aucun `tsconfig.sidebar-test.json` n'existe |
| `backend/dist/` | build committé en arborescence |

**Décision requise** — `(public)` et `(scanner)` ne produisent **aucune route** (ni `layout.tsx` ni `page.tsx`), mais contiennent `error.tsx`, `loading.tsx` et 8 `.gitkeep`. Soit on crée leurs pages, soit on supprime les groupes. Laisser un groupe de routes fantôme induit en erreur.

**Pourquoi** — deux taxonomies concurrentes garantissent que le code finira réparti au hasard entre les deux, et qu'aucune ne sera complète.

**Checks** — `lint` `typecheck` `build`

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

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| `rm -rf web/.git` exécuté sans vérifier son contenu | EVT-001 étape 1 : inspecter `git log` avant |
| `docker/.env` committé avec de vrais mots de passe | `secret-scan` bloquant + job « no `.env` tracked » |
| La strictness TypeScript révèle beaucoup d'erreurs d'un coup | Le code réel est quasi inexistant : 3 fichiers avec de la logique. C'est précisément pourquoi on le fait **maintenant** |
| `(public)` / `(scanner)` laissés en l'état « pour plus tard » | Décision explicite exigée par EVT-004 |
