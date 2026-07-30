# ADR-0017 — Modèle de livraison : sprints, branches, PR et checks

| | |
|---|---|
| **Statut** | **Accepté — partiellement supersédé par [ADR-0018](0018-git-branching-model.md)** |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | comble un trou total — aucun processus n'était défini |
| **Impacte** | `.github/`, `SPRINT_PLAN.md`, toute contribution |

> ⚠️ **Le modèle de branches de cet ADR est supersédé.** La section « Branches » ci-dessous décrivait un modèle **trunk-based** avec une seule branche `main`. Il est remplacé par **`master` + `develop`** — voir [ADR-0018](0018-git-branching-model.md) et [`GIT_STRATEGY.md`](../operations/GIT_STRATEGY.md).
>
> **Tout le reste de cet ADR reste normatif** : sprints de 2 semaines, identifiants `EVT-###`, Conventional Commits, branches de feature de moins de 3 jours, squash vers l'intégration, gabarit de PR, Definition of Ready et of Done, activation progressive des checks.

## Contexte

Le corpus contient **quatre** listes de phases techniques concurrentes et non réconciliées : Document B §50 (10 phases), Document D §40 (8 phases), Document A §11 (8 migrations), contexte produit §18 (17 phases). Aucune ne porte d'estimation, de dépendance ni d'affectation.

Aucun document ne définit de branches, de convention de commit, de gabarit de PR, de gate de revue ni de pipeline CI. Le dépôt ne contient **aucun** répertoire `.github/`.

État git au 30 juillet 2026 : `master` sans aucun commit, et `web/.git` est un dépôt imbriqué distinct — committer `web/` aujourd'hui produirait un lien de sous-module vide au lieu du code source.

## Décision

### Cadence

**Sprints de 2 semaines**, 12 sprints planifiés. La séquence unique est établie dans [`IMPLEMENTATION_ROADMAP.md`](../sprints/IMPLEMENTATION_ROADMAP.md), qui réconcilie les quatre listes concurrentes.

### Identifiants de feature

`EVT-###`, numérotation continue à travers les sprints, jamais réutilisée. L'identifiant apparaît dans la branche, le commit, le titre de PR et les tests.

### ~~Branches — trunk-based, branches courtes~~ → voir [ADR-0018](0018-git-branching-model.md)

> **Section supersédée.** Le modèle retenu est `master` + `develop`.

```
master                      production uniquement, tags de release
develop                     intégration, source des branches de feature
feat/EVT-014-refresh-token-rotation
fix/EVT-014-cookie-path
chore/EVT-002-eslint-strict
docs/EVT-000-adr-idempotency
```

Durée de vie visée : **moins de 3 jours**. Merge en **squash** vers `develop`, ce qui rend l'historique de `develop` égal à la liste des features livrées.

### Commits — Conventional Commits

```
feat(identity): rotate refresh tokens with reuse detection
fix(identity): scope refresh cookie path to /api/v1/auth/sessions
test(attendance): add duplicate check-in negative case
```

Portées autorisées : les noms de modules backend et de features frontend, plus `infra`, `docs`, `ci`, `db`.

### Pull requests

Titre : `[EVT-014] feat(identity): refresh token rotation`

Le gabarit impose une **Definition of Done** reprenant les 21 items du contexte produit §19, plus une section « Impact sécurité » obligatoire dès que la PR touche l'authentification, l'autorisation, le multi-tenant ou la base.

### Checks requis avant merge

| Check | Bloquant dès |
|---|---|
| `lint` | sprint 01 |
| `typecheck` | sprint 01 |
| `test:unit` | sprint 01 |
| `build` | sprint 01 |
| `secret-scan` | sprint 01 |
| `test:integration` | sprint 03 |
| `prisma:migrate:diff` | sprint 03 |
| `arch:tenant-isolation` | sprint 06 |
| `test:e2e` | sprint 04 |

Les jobs sont **écrits dès le sprint 01** mais gardés en `continue-on-error` tant que leur sprint d'activation n'est pas atteint, chaque garde portant un `TODO` nommant le sprint qui le retire. Un badge vert qui ment est pire que pas de badge.

### Definition of Ready

Une feature n'entre dans un sprint que si : la règle métier est écrite, la table et l'index sont spécifiés, la route et le DTO sont définis, la règle d'autorisation est explicite, et les tests négatifs attendus sont listés.

### Definition of Done

Les 21 items du contexte produit §19. Une feature n'est jamais `DONE` sur la seule existence du code.

## Conséquences

**Positives** — un historique lisible ; une PR par feature traçable jusqu'à l'ADR qui la justifie ; les gates de sécurité sont dans le pipeline, pas dans la discipline individuelle ; la CI est honnête sur ce qui est réellement vérifié.

**Négatives** — pour une équipe réduite, le gabarit de PR peut sembler lourd ; il est délibérément conçu comme une checklist à cocher, pas comme un texte à rédiger. Le trunk-based exige des features réellement découpées, ce que le plan de sprint impose déjà.

**Un blocage de dépôt reste prérequis au sprint 01** : le dépôt git imbriqué `web/.git`, sans quoi le frontend n'est pas réellement poussé. Le second blocage identifié — `docker/.env.example` vide sur 0 octet — a été corrigé le 30 juillet 2026.

## Alternatives rejetées

- **Sprints d'une semaine** — points de contrôle plus fréquents, mais plusieurs features de ce plan (authentification cœur, multi-tenant) ne se découpent pas proprement en une semaine avec leurs tests.
- **Git flow (`develop` + `release`)** — utile avec des releases versionnées et plusieurs versions supportées en parallèle ; ici, une seule version en production, `develop` ne serait qu'une file d'attente supplémentaire.

## Vérification

`.github/workflows/*.yml` sont syntaxiquement valides et les jobs non encore activés portent un `TODO` nommant leur sprint de bascule.
