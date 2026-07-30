# Eventini — Plan de sprints

> **Statut :** Spécification normative · **Version :** 1.1 · **Date :** 30 juillet 2026
> **Cadence :** 12 sprints × 2 semaines · **73 tickets** · **14 migrations** · **24 semaines**
> **Processus :** [ADR-0017](../adr/0017-delivery-model.md) · **Séquence et invariants :** [`IMPLEMENTATION_ROADMAP.md`](IMPLEMENTATION_ROADMAP.md)

Ce document porte les **conventions communes**. Le détail de chaque sprint vit dans son propre dossier.

---

## 1. Les 12 sprints

| Sprint | Thème | Tickets | Migrations | Jalon |
|---|---|---|---|---|
| [**01**](sprint-01/README.md) | Stabilisation du dépôt | EVT-001 → 007 | — | |
| [**02**](sprint-02/README.md) | Bootstrap sécurisé | EVT-008 → 013 | — | |
| [**03**](sprint-03/README.md) | Base de données | EVT-014 → 019 | 1, 2, 3, 8 | 🏁 **M1 Fondations** |
| [**04**](sprint-04/README.md) | Authentification cœur | EVT-020 → 027 | 4, 5, 6 | |
| [**05**](sprint-05/README.md) | Sécurité web | EVT-028 → 032 | 13 | |
| [**06**](sprint-06/README.md) | Multi-tenant et autorisation | EVT-033 → 036 | — | 🏁 **M2 Identité** |
| [**07**](sprint-07/README.md) | Frontend authentification | EVT-037 → 041 | — | |
| [**08**](sprint-08/README.md) | Organisations | EVT-042 → 047 | — | |
| [**09**](sprint-09/README.md) | Événements et sessions | EVT-048 → 053 | — | 🏁 **M3 Administration** |
| [**10**](sprint-10/README.md) | Participants et inscriptions | EVT-054 → 059 | 9, 10 | |
| [**11**](sprint-11/README.md) | Tickets, QR et scanners | EVT-060 → 065 | 7, 11 | |
| [**12**](sprint-12/README.md) | Présence, offline et temps réel | EVT-066 → 073 | 12, 14 | 🏁 **M4 MVP** |

**Chemin critique** — `01 → 02 → 03 → 04 → 05 → 06 → 09 → 10 → 11 → 12`. Les sprints **07 et 08 sont parallélisables** une fois le sprint 06 terminé.

> **M2 (sprint 06) est le jalon décisif.** Après lui, chaque feature métier hérite gratuitement de l'isolation et de l'autorisation. Avant lui, chaque feature écrite devrait être reprise.

---

## 2. Identifiants de feature

`EVT-###`, **continu à travers les sprints**, **jamais réutilisé**. L'identifiant apparaît dans la branche, le commit, le titre de PR et les noms de tests — c'est ce qui rend une feature traçable de l'issue jusqu'à la ligne de code.

---

## 3. Branches

Modèle **`master` + `develop`** — [ADR-0018](../adr/0018-git-branching-model.md), détail dans [`GIT_STRATEGY.md`](../operations/GIT_STRATEGY.md).

```
master     production uniquement, tags de release
develop    intégration — SOURCE DE TOUTE BRANCHE DE FEATURE

feat/EVT-024-refresh-token-rotation
fix/EVT-039-frontend-route-guards
chore/EVT-002-strict-typescript
docs/EVT-000-adr-idempotency
test/EVT-036-tenant-isolation
```

| Règle | |
|---|---|
| Base | **`develop`**, jamais `master` |
| Cible de la PR | **`develop`** |
| Durée de vie visée | **moins de 3 jours** |
| Merge | **squash** — l'historique de `develop` devient la liste des features livrées |
| `master` et `develop` | protégées : push direct interdit, revue obligatoire, checks requis |
| Conflits | rebase sur `develop`, jamais de merge de `develop` dans la feature |

**Releases aux jalons** — après les sprints **03, 06, 09, 12** (`v0.1.0`, `v0.2.0`, `v0.3.0`, `v1.0.0`). Une release passe par `release/vX.Y.Z`, merge `--no-ff` vers `master` **et rétro-merge obligatoire vers `develop`**.

---

## 4. Commits — Conventional Commits

```
feat(identity): rotate refresh tokens with reuse detection
fix(identity): scope refresh cookie path to /api/v1/auth/sessions
chore(config): enable strict TypeScript across backend
test(attendance): add duplicate check-in negative case
docs(adr): record idempotency storage decision
```

**Portées autorisées** — les noms de modules backend (`identity`, `events`, `attendance`, …), les noms de features frontend, plus `infra`, `docs`, `ci`, `db`, `config`, `api`, `security`, `web`.

---

## 5. Pull requests

**Titre**

```
[EVT-014] feat(identity): refresh token rotation
```

Le gabarit [`.github/pull_request_template.md`](../../.github/pull_request_template.md) impose :

- la **Definition of Done** — les 21 items du contexte produit §19 ;
- une section **impact sécurité**, obligatoire dès que la PR touche l'authentification, l'autorisation, le multi-tenant, la base ou une entrée externe ;
- un tableau de **tests négatifs** — lister uniquement des tests de chemin nominal ne suffit pour rien de ce qui touche à la sécurité ;
- une **preuve d'exécution** réelle, pas « les tests passent » ;
- les **plans de requête** pour toute PR touchant la base.

---

## 6. Checks requis

| Check | Bloquant dès |
|---|---|
| `lint` | sprint 01 |
| `typecheck` | sprint 01 |
| `test:unit` | sprint 01 |
| `build` | sprint 01 |
| `secret-scan` | sprint 01 |
| `test:integration` | sprint 03 |
| `prisma:migrate:diff` | sprint 03 |
| `test:e2e` | sprint 04 |
| `arch:tenant-isolation` | sprint 06 |

Les jobs sont **écrits dès le sprint 01** mais gardés en `continue-on-error` jusqu'à leur sprint d'activation, chaque garde portant un `TODO` nommant ce sprint.

> **Un badge vert qui ment est pire que pas de badge.**

Deux jobs sont **bloquants immédiatement**, parce que leurs cibles existent déjà : `lua` (les 4 scripts sont écrits et vérifiés) et `docs` (liens internes et absence de références au répertoire `api/` inexistant).

**Budget de tests placeholder** — la CI compte les `it.todo` et échoue si leur nombre **augmente**. Le budget actuel est de 31 ; il descend à chaque sprint, jusqu'à 0 au sprint 06.

---

## 7. Definition of Ready

Une feature n'entre dans un sprint que si :

- [ ] la règle métier est écrite, y compris ses cas limites ;
- [ ] la table et l'index sont spécifiés ;
- [ ] la route et le DTO sont définis ;
- [ ] la règle d'autorisation est explicite — quelle permission, quelle portée, quelle vérification de propriété ;
- [ ] **les tests négatifs attendus sont listés**.

Une feature spécifiée uniquement par son chemin nominal n'est pas prête.

---

## 8. Definition of Done

Les 21 items du contexte produit §19. Une feature n'est **jamais** `DONE` sur la seule existence du code.

```
besoin métier compris · règles documentées · modèle DB · migration
contraintes et index · use case · repository · route/API · DTO validation
authorization · tenant isolation · audit/security events · gestion d'erreurs
tests unitaires · tests d'intégration · tests E2E · documentation API
frontend connecté · observabilité · build vert · preuve d'exécution
```

Statuts intermédiaires : `MISSING` · `SKELETON` · `PARTIAL` · `BROKEN` · `IMPLEMENTED` · `DONE` · `DEFERRED`.

---

## 9. Structure d'un dossier de sprint

```
docs/sprints/
├── SPRINT_PLAN.md              ← ce document : conventions communes
├── IMPLEMENTATION_ROADMAP.md   ← séquence, invariants d'ordre, jalons
├── sprint-01/README.md
├── sprint-02/README.md
└── …
```

Chaque `README.md` de sprint contient :

| Section | Contenu |
|---|---|
| Entête | tickets, prérequis, migrations, jalon |
| Objectif | ce que le sprint rend possible, et l'invariant d'ordre qui le justifie |
| Critère de sortie | **vérifiable**, pas déclaratif |
| Tickets | table d'index, puis détail par ticket |
| Détail par ticket | scope, hors scope, branche, commit, PR, tables, routes, sécurité, checks, **tests négatifs**, vérification |
| Risques | ce qui peut mal tourner dans ce sprint précis, et l'atténuation |

Un dossier de sprint peut accueillir des fichiers supplémentaires si le besoin apparaît — notes de revue, résultats de tests de charge, captures de plans de requête.

---

## 10. Travaux transverses

Non affectés à un sprint, dus **à chaque** sprint.

| Travail | Règle |
|---|---|
| Tests | aucune feature n'est `DONE` sans ses tests, **y compris négatifs** |
| Documentation | un changement de contrat met à jour son document **dans la même PR** |
| ADR | toute décision structurante produit un ADR **avant** le code |
| Migrations | toujours expand/contract, jamais destructif en une passe |
| Observabilité | toute opération sensible nouvelle émet un security event ou un audit log |
| OpenAPI | toute route nouvelle est documentée ; la CI détecte les ruptures |
| Runbooks | toute alerte nouvelle arrive avec sa procédure |

---

## 11. Où trouver quoi

| Besoin | Document |
|---|---|
| Pourquoi cet ordre de sprints | [`IMPLEMENTATION_ROADMAP.md`](IMPLEMENTATION_ROADMAP.md) |
| Colonnes, index, contraintes | [`DATABASE_SCHEMA.md`](../database/DATABASE_SCHEMA.md) |
| Migrations, seed, rollback | [`MIGRATION_STRATEGY.md`](../database/MIGRATION_STRATEGY.md) |
| Paramètres crypto, TTL, chaîne d'autorisation | [`AUTHENTICATION_AUTHORIZATION.md`](../security/AUTHENTICATION_AUTHORIZATION.md) |
| Limites de débit, lockout | [`RATE_LIMITING_AND_ABUSE_PREVENTION.md`](../security/RATE_LIMITING_AND_ABUSE_PREVENTION.md) |
| Menaces, risques acceptés | [`THREAT_MODEL.md`](../security/THREAT_MODEL.md) |
| Enveloppe, codes d'erreur, routes | [`API_CONVENTIONS.md`](../api/API_CONVENTIONS.md) |
| Idempotence, concurrence | [`IDEMPOTENCY_AND_CONCURRENCY.md`](../api/IDEMPOTENCY_AND_CONCURRENCY.md) |
| Clés Redis, scripts Lua | [`REDIS_KEYS_AND_LUA_SCRIPTS.md`](../infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md) |
| Variables d'environnement | [`ENVIRONMENT_VARIABLES.md`](../operations/ENVIRONMENT_VARIABLES.md) |
| Défauts frontend F-1 à F-12 | [`FRONTEND_ARCHITECTURE.md`](../architecture/FRONTEND_ARCHITECTURE.md) |
| État réel audité du dépôt | [`SYSTEM_ARCHITECTURE.md` §3](../architecture/SYSTEM_ARCHITECTURE.md) |
| Décisions et contradictions résolues | [`adr/README.md`](../adr/README.md) · [`PROJECT_DOCUMENTATION_INDEX.md` §5](../PROJECT_DOCUMENTATION_INDEX.md) |
