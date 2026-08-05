# Sprint 06 — Multi-tenant et autorisation

> [← Sprint 05](../sprint-05/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 07 →](../sprint-07/README.md)

| | |
|---|---|
| **Tickets** | EVT-033 → EVT-036 |
| **Prérequis** | Sprint 05 |
| **Migrations** | aucune |
| **Jalon** | 🏁 **M2 — Identité** |

---

## Objectif

La chaîne d'autorisation en 8 étapes, **prouvée par des tests cross-tenant**.

Invariant **O-5** : le multi-tenant précède toute feature métier. Ajouter l'isolation après coup impose de réécrire chaque requête déjà écrite.

> **C'est le sprint le plus important du projet.** Passé M2, chaque feature métier hérite gratuitement de l'isolation et de l'autorisation. Avant M2, chaque feature écrite devrait être reprise.

## Critère de sortie

- **un ID valide appartenant à un autre tenant retourne `403`** ;
- une requête non scopée lève `TenantScopeViolationError` ;
- `tenant-isolation.spec.ts` passe avec des **assertions réelles** (il contient aujourd'hui 2 `it.todo`).

---

## Tickets

| # | Titre |
|---|---|
| [EVT-033](#evt-033) | Contexte tenant et activation d'organisation ✅ |
| [EVT-034](#evt-034) | Résolution et cache des permissions |
| [EVT-035](#evt-035) | Guards globaux et décorateurs |
| [EVT-036](#evt-036) | Tests d'isolation cross-tenant |

---

## EVT-033 — Contexte tenant et activation d'organisation
<a id="evt-033"></a>

> ✅ **Fait le 5 août 2026.** 15 tests unitaires, 11 tests e2e contre PostgreSQL réel.

### La rotation, et pourquoi ce n'est pas un `UPDATE`

Mettre `user_sessions.organization_id` à jour sur place tiendrait en une instruction et serait faux deux fois : un refresh token capturé **avant** le changement continuerait de fonctionner **après**, pointant désormais sur la nouvelle organisation ; et la piste d'audit montrerait une session qui a silencieusement changé de tenant au lieu de deux sessions avec une transition explicite.

Un test le prouve directement : après activation, l'ancienne session est `REPLACED`, sa famille de tokens est révoquée, et l'ancien cookie d'accès reçoit `401`.

### 🔴 Le niveau d'authentification est **transporté**, jamais supposé

Une première version câblait `authenticationLevel: 'MFA'` en dur. C'était une escalade de privilège dans une route qui ne prétend que changer d'organisation : chaque bascule aurait accordé une garantie MFA jamais obtenue. Câbler `'PASSWORD'` aurait le défaut inverse — perdre une vérification réellement faite, et faire refuser plus tard un `@RequireAuthLevel` à quelqu'un qui avait bien vérifié.

Seul le niveau de la session remplacée est correct. Trois tests le vérifient, un par niveau.

### L'identifiant du chemin ne construit jamais une requête

Il sert uniquement à **retrouver un membership appartenant à l'appelant**. Un identifiant forgé ne trouve rien, au lieu de scoper une requête sur le tenant de quelqu'un d'autre. Le test utilise une organisation **réelle et active** dont l'utilisateur n'est pas membre — pas une chaîne inventée, parce que c'est l'identifiant réel qu'un attaquant utiliserait.

Les deux refus sont **identiques au bit près** (hors `instance` et `requestId`, qui diffèrent par construction) : distinguer « pas de membership » de « organisation suspendue » permettrait d'énumérer les identifiants d'organisation.

### 🔴 Trois règles d'architecture ont refusé ce ticket, et elles avaient raison

| Règle | Ce qu'elle a attrapé | Résolution |
|---|---|---|
| `$unscoped` sur liste blanche | deux requêtes non scopées | ajoutées avec justification |
| Repository → `TenantContext` d'abord | `OrganizationRepository` n'en prend pas | exempté, avec la raison |
| Frontières de modules | 10 imports profonds dans `identity` | **surface publique explicite** |

Les deux `$unscoped` sont structurellement nécessaires : « à quelles organisations j'appartiens » **est** l'ensemble des organisations, et une activation vise justement celle sur laquelle la session n'est pas encore scopée — filtrer sur le contexte courant rendrait tout changement impossible. Ce qui les rend sûres est le filtre `userId`.

La troisième a produit le meilleur résultat du ticket : `modules/identity/index.ts` déclare désormais une **surface publique nommée** au lieu d'être un `export *`. Tout ce qui n'y figure pas est interne par construction, et l'élargir est une ligne visible en revue.

### Structure livrée

```
organizations/domain/organization.repository.ts        le port
organizations/infrastructure/prisma-organization.repository.ts
organizations/application/{list,activate}-organization.use-case.ts
organizations/controllers/organizations.controller.ts
identity/tenant-access/tenant-context.service.ts       Caller → TenantContext
```

`SessionIssuer` gagne `issueResolved` : les étapes 14-15 avec l'organisation **déjà décidée**. Le login y arrive par `issue` qui résout d'abord ; la bascule y arrive directement, puisque la cible est choisie et déjà vérifiée. La session remplacée est retirée **dans la même transaction** que sa remplaçante — les valider séparément laisserait une fenêtre à deux sessions vivantes, ou à zéro.

```
Branche  feat/EVT-033-tenant-context
Commit   feat(identity): resolve tenant context from session with explicit switching
Routes   POST /api/v1/organizations/{organizationId}/activation
         GET  /api/v1/organizations
```

**Décision** — l'organisation active est portée par la **session serveur** ([ADR-0002](../../adr/0002-active-organization-resolution.md)).

```
Cookie __Host-eventini_access → claim sid
  → user_sessions.organization_id + active_membership_id
  → TenantContext { organizationId, membershipId, userId, sessionId, authLevel }
```

Un `organizationId` reçu du client (path, query, body) n'est **jamais** utilisé pour construire une requête. Il est uniquement **comparé** au contexte : divergence ⇒ `403 AUTH_TENANT_DENIED` + security event.

### Le changement d'organisation rote la session

```
POST /api/v1/organizations/{organizationId}/activation
  1. membership ACTIVE pour (user, organization) ?      sinon 403
  2. organisation ACTIVE, is_enabled = true ?           sinon 403
  3. nouvelle ligne user_sessions, nouvelle token_family_id
  4. ancienne session → REPLACED, tokens révoqués
  5. nouveaux cookies access + refresh + CSRF
  6. security event ORGANIZATION_CONTEXT_SWITCHED
```

**Pourquoi une rotation complète** — un token volé ne survit pas au changement de contexte, et la piste d'audit est explicite.

**Limite assumée** — un utilisateur ne peut pas travailler sur deux organisations dans deux onglets. Le changement est global à la session. C'est le compromis retenu au profit de l'isolation.

**Sessions plateforme** — `SUPER_ADMIN` sans organisation : `organization_id IS NULL` **et** `active_membership_id IS NULL`, garanti par `ck_sessions_tenant_coherence`.

**Tests**

- un `organizationId` forgé dans le corps ou l'URL est **ignoré**, jamais utilisé ;
- changement de contexte ⇒ ancienne session `REPLACED`, anciens tokens inutilisables ;
- activation vers une organisation sans membership ⇒ `403` ;
- activation vers une organisation `SUSPENDED` ⇒ `403`.

---

## EVT-034 — Résolution et cache des permissions
<a id="evt-034"></a>

```
Branche  feat/EVT-034-permission-resolution
Commit   feat(identity): resolve scoped permissions with versioned Redis cache
```

**Décision** — l'access token ne contient **aucune** permission ([ADR-0004](../../adr/0004-permission-resolution-and-caching.md)).

### Routage par portée

| Portée du rôle | Table interrogée |
|---|---|
| `PLATFORM` | `platform_role_assignments` |
| `ORGANIZATION` | `membership_role_assignments` |
| `EVENT` | `event_user_assignments` |

Une permission de portée `EVENT` n'est accordée que si une assignation **non révoquée et dans sa fenêtre de validité** existe. Les bornes `valid_from` / `valid_until` font partie du **filtre SQL**, pas d'un contrôle applicatif ultérieur.

**Une permission d'organisation n'accorde pas automatiquement l'accès à tous les événements.** Un utilisateur peut être `CLIENT_ADMIN` de A, analyste de B, autorisé uniquement sur l'événement X de B, sans aucun droit sur Y — c'est l'exemple du contexte produit §7.3, et le modèle le supporte littéralement.

### Cache versionné

```
perms:{membershipId}:v{permissionsVersion}      TTL 300 s
perms:platform:{userId}:v{permissionsVersion}   TTL  60 s
```

`permissionsVersion` est incrémenté **dans la transaction** de tout changement de rôle, de membership ou de statut d'organisation.

**Invalidation par incrément, pas par suppression** — incrémenter rend toutes les clés de l'ancienne version inatteignables d'un coup, sans parcourir de clés. Une suppression par motif exigerait `SCAN`, serait partielle sous charge, et **laisserait passer des permissions révoquées**.

**Repli** — Redis absent ⇒ lecture PostgreSQL, log `warn`, métrique `redis_fallback_total`. **Jamais** de repli sur « autoriser ».

**Test décisif** — révoquer un rôle, puis appeler immédiatement une route protégée **avec le token existant** ⇒ `403`, sans attendre l'expiration de l'access token. C'est ce qu'aucune approche par permissions-dans-le-token ne permet.

---

## EVT-035 — Guards globaux et décorateurs
<a id="evt-035"></a>

```
Branche  feat/EVT-035-authorization-guards
Commit   feat(identity): add global guard chain with opt-in public access
```

**État actuel** — `PermissionsGuard`, `RolesGuard`, `ResourceAccessGuard`, `TenantContextGuard`, `CsrfGuard` existent comme **classes vides**. Aucune n'implémente `CanActivate`, aucune ne porte `@Injectable()`. `JwtAuthGuard` et `ScannerGuard` n'existent pas du tout.

### Ordre d'exécution

```
CsrfGuard → AuthenticationGuard → TenantContextGuard → PermissionsGuard → ResourceGuard
```

| Guard | Étapes de la chaîne | Refus |
|---|---|---|
| `CsrfGuard` | méthode, Origin, cookie, header, signature, liaison | `403 AUTH_CSRF_INVALID` |
| `AuthenticationGuard` | 1-3 : token, session, utilisateur | `401` |
| `TenantContextGuard` | 4-5 : organisation, membership | `403 AUTH_TENANT_DENIED` |
| `PermissionsGuard` | 6 : permission effective | `403 AUTH_PERMISSION_DENIED` |
| `ResourceGuard` | 7-8 : propriété + état — **dans le use case** | `403` / `409` |

Les étapes 7-8 ne peuvent pas être un guard global : elles exigent de charger la ressource. Elles sont portées par une méthode de repository qui **exige** le `TenantContext`.

### 🔴 Les guards sont globaux, l'accès public est un opt-in

```ts
{ provide: APP_GUARD, useClass: AuthenticationGuard },
{ provide: APP_GUARD, useClass: TenantContextGuard },
{ provide: APP_GUARD, useClass: PermissionsGuard },
```

C'est l'inverse du réflexe courant, et c'est délibéré : **une route nouvelle est protégée par défaut**. Avec des guards posés route par route, l'oubli d'un décorateur crée une route ouverte silencieuse — et personne ne remarque une route qui répond `200`.

L'ouverture se fait par `@Public()`, explicite et visible en revue.

**Attention DI** — aucune classe du backend ne porte `@Injectable()` aujourd'hui. Nest le tolère parce qu'aucune n'a de paramètre de constructeur. **Ajouter une seule dépendance à un guard sans `@Injectable()` fera échouer le bootstrap.**

**Tests**

- une route nouvelle sans décorateur ⇒ **protégée** ;
- `@RequirePermission` de portée `EVENT` sans assignation ⇒ `403` ;
- `@RequireAuthLevel('REAUTHENTICATED')` avec une session `PASSWORD` ⇒ `403 AUTH_REAUTHENTICATION_REQUIRED`.

---

## EVT-036 — Tests d'isolation cross-tenant
<a id="evt-036"></a>

```
Branche  test/EVT-036-tenant-isolation
Commit   test(architecture): implement tenant isolation architecture tests
```

> **C'est le ticket le plus important du sprint.** Il transforme une règle documentée en règle **appliquée**.

**État actuel** — `backend/src/__architecture__/tenant-isolation.spec.ts` existe et contient exactement **deux `it.todo`**. `forbidden-imports.spec.ts` en contient trois.

### `tenant-isolation.spec.ts` — à implémenter

1. tout modèle Prisma tenant-owned possède `organization_id` ;
2. toute méthode publique de repository sur un modèle tenant-owned prend un `TenantContext` en **premier** paramètre ;
3. aucun appel à `prisma.$unscoped` hors de la liste blanche des opérations plateforme.

### `forbidden-imports.spec.ts` — à implémenter

La matrice de strates et les arêtes interdites de [`MODULE_DEPENDENCY_MAP.md`](../../architecture/MODULE_DEPENDENCY_MAP.md) :

- `common/` et `config/` n'importent jamais `modules/` ;
- `infrastructure/` n'importe jamais `modules/` ;
- `domain/` ne dépend d'aucun framework (Nest, Prisma, Express) ;
- `tenant-access` n'importe jamais `authorization` ;
- aucun cycle entre modules métier (`madge --circular`).

### Tests e2e cross-tenant

| Test | Attendu |
|---|---|
| ID valide d'un autre tenant | `403 AUTH_TENANT_DENIED`, **jamais** `200` |
| Idem sur exports, sessions, événements, participants, scanners | `403` |
| Requête volontairement non scopée | `TenantScopeViolationError` |
| Rôle révoqué, access token encore valide | `403` immédiat |
| Session révoquée, access token encore valide | `401` |
| Organisation suspendue | toutes les routes métier refusées |
| Membership révoqué | sessions coupées dans la **même transaction** |

**Le job CI `arch:tenant-isolation` devient bloquant à la fin de ce sprint.**

---

## 🏁 Jalon M2 — Identité

Le **socle de sécurité est terminé**. Authentification complète, isolation multi-tenant prouvée par test, autorisation scopée aux quatre niveaux.

C'est le jalon qui conditionne tout le reste : chaque feature des sprints 08 à 12 hérite gratuitement de ces garanties.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| Guards posés route par route au lieu d'être globaux | `APP_GUARD` + test « route nouvelle protégée par défaut » |
| `tenant-isolation.spec.ts` laissé en `it.todo` | Critère de sortie ; job CI bloquant |
| Cache de permissions invalidé par suppression de clé | Invalidation par version imposée ; test de révocation immédiate |
| `permissionsVersion` incrémenté hors transaction | Test : révocation de rôle ⇒ `403` immédiat |
| Un guard reçoit une dépendance sans `@Injectable()` | Le bootstrap échoue — à détecter tôt |
| `$unscoped` utilisé « temporairement » pour débloquer | Liste blanche + alerte sur `UNSCOPED_QUERY_EXECUTED` |
