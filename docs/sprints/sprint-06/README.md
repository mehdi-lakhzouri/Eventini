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
| [EVT-034](#evt-034) | Résolution et cache des permissions ✅ |
| [EVT-035](#evt-035) | Guards globaux et décorateurs ✅ |
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

> ✅ **Fait le 5 août 2026.** 12 tests unitaires, 10 tests d'intégration contre PostgreSQL réel. La garde qui consomme ce résolveur arrive avec [EVT-035](#evt-035) — voir « ce qui n'est pas encore prouvé » plus bas.

### L'invalidation par version, et ce qu'elle évite

Incrémenter rend toutes les clés de l'ancienne version inatteignables d'un coup : aucune clé à retrouver, aucun `SCAN`, aucune suppression partielle. Une suppression par motif serait partielle sous charge, et une clé manquée signifie **une permission révoquée encore accordée** — exactement ce que ce mécanisme existe pour empêcher.

### 🔴 Le compteur de version n'a **jamais** de TTL

Le compteur et les entrées de cache vivent dans le même Redis. Si le compteur expirait pendant que des entrées survivent, la version redescendrait et les entrées périmées **redeviendraient atteignables**. Les perdre ensemble est inoffensif : il ne reste rien à ressusciter. D'où la règle : les entrées portent un TTL, les compteurs jamais.

C'est écrit dans le code à l'endroit où quelqu'un serait tenté d'en ajouter un.

### Trois scopes, trois tables, et une fenêtre de validité dans le SQL

| Scope | Table | Particularité |
|---|---|---|
| `ORGANIZATION` | `membership_role_assignments` | révocation par `revoked_at` **seul** |
| `PLATFORM` | `platform_role_assignments` | a `status` **et** `revoked_at` |
| `EVENT` | `event_user_assignments` | fenêtre `valid_from` / `valid_until` dans le `WHERE` |

**Les bornes de validité sont dans le filtre SQL**, pas vérifiées ensuite. Un filtre appliqué en code applicatif est un filtre qu'un `return` anticipé ou un refactor peut sauter ; une ligne hors de sa fenêtre ne doit pas être **retournée** du tout.

**Les permissions d'événement ne sont pas mises en cache.** L'ensemble dépend de l'événement *et* de l'horloge : une copie en cache survivrait à la fenêtre dans laquelle elle a été calculée et continuerait d'accorder l'accès après expiration.

### 🔴 Deux découvertes des tests d'intégration

**`membership_role_assignments` n'a pas de colonne `status`.** Ma requête en filtrait une. C'est asymétrique avec `platform_role_assignments`, qui a les deux. Le test d'intégration l'a attrapé parce qu'il s'exécute contre le vrai schéma — un dépôt factice aurait répondu ce qu'on lui aurait dit de répondre.

**INV-09 est un trigger, pas seulement une convention.** Le test « un rôle PLATFORM ne passe pas par une assignation de membership » ne peut même pas **insérer** la ligne : la base la refuse. C'est une garantie plus forte que le filtre `scope` de la requête, et le test asserte désormais la vraie. Le filtre reste comme seconde ligne de défense — c'est lui qui tiendrait si le trigger disparaissait dans une migration.

### 🟡 Ce qui n'est pas encore prouvé, et pourquoi

Le **test décisif d'ADR-0004** — révoquer un rôle puis appeler une route protégée avec le token existant ⇒ `403` immédiat — exige une route protégée. `PermissionsGuard` est EVT-035. La propriété est donc prouvée ici **au niveau SQL** (une assignation révoquée cesse d'accorder immédiatement) et **au niveau du cache** (un incrément de version rend l'ancienne entrée inatteignable) ; la preuve bout en bout arrive avec la garde.

**La colonne miroir d'ADR-0004 n'est pas créée.** L'ADR décrit « un compteur Redis + une colonne miroir » ; le sprint 06 déclare **aucune migration**. Elle n'est pas nécessaire à la correction — compteur et cache partagent un Redis, donc ils se perdent ensemble, et un compteur qui repart de zéro ne peut pas exposer des entrées disparues avec lui. Ce qu'elle apporterait est la durabilité après une perte totale de Redis, à des fins d'audit. Noté comme limite plutôt que passé sous silence.

### Structure livrée

```
authorization/domain/        permission.repository.ts · permission-cache.ts
                             permissions-version.store.ts
authorization/infrastructure/ prisma-permission.repository.ts
                             redis-permission.cache.ts
                             redis-permissions-version.store.ts
authorization/application/   permission-resolver.service.ts
```

Redis est une optimisation, **jamais une autorité** : défaut de version, défaut de lecture et défaut d'écriture terminent tous dans PostgreSQL. Aucune branche ne renvoie « autorisé » parce qu'une recherche a échoué — trois tests l'exigent, un par mode de panne.

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

> ✅ **Fait le 11 août 2026.** 11 tests e2e dédiés à la chaîne, contre PostgreSQL et Redis réels. Suite complète : 1046 unitaires, 139 d'intégration, 179 e2e.

### 🔴 Protégé par défaut, ouvert par exception

```
RateLimit → Csrf → Authentication → TenantContext → Permissions
```

Le test qui porte tout le ticket : **une route sans aucun décorateur répond `401`**. Avec des guards posés route par route, un décorateur oublié produit une route ouverte qui répond `200`, et personne n'enquête sur un `200`. Inversé, le même oubli produit un `401`, qui remonte dans l'heure.

`@Public()` est la seule sortie. Cinq routes la portent, et chacune a une raison qui tient en une phrase :

| Route | Pourquoi |
|---|---|
| `POST /auth/sessions` | c'est la frontière elle-même |
| `POST /auth/sessions/current/rotation` | s'authentifie sur le cookie refresh, précisément quand l'access token a expiré |
| `POST /auth/mfa/challenges/{id}/verification` | seconde étape d'un login gaté : mot de passe prouvé, session pas encore créée |
| `GET /auth/csrf-token` | délivre le jeton qui permet la première mutation, dont le login — l'exiger serait circulaire |
| `POST /auth/password-reset*` | s'adresse à quelqu'un qui ne peut pas se connecter |

Plus `/health/*` et `/metrics`, appelés par la plateforme et non par un utilisateur.

### L'ordre est fixé à un seul endroit

Nest exécute les `APP_GUARD` dans l'ordre d'initialisation des modules. Les enregistrer dans `AuthorizationModule` les aurait placés là où la liste d'imports d'`IdentityModule` les met — c'est-à-dire **avant `CsrfModule`**, par ordre alphabétique. Rien n'aurait paru anormal en lisant l'un ou l'autre fichier.

D'où `GuardChainModule` : un module dont le seul rôle est de déclarer la séquence, importé par `AppModule` après `IdentityModule`. Deux tests e2e vérifient l'ordre par le comportement plutôt que par la lecture du code.

### 🔴 Une exemption explicite plutôt qu'un cas particulier caché

`TenantContextGuard` compare tout `organizationId` reçu — chemin, query **et** corps — au contexte de la session, et refuse une divergence. Or `POST /organizations/{id}/activation` en nomme délibérément une autre : c'est sa raison d'être.

L'exemption est un décorateur, `@AllowsOrganizationSwitch()`, posé sur la route concernée, et non une liste de chemins à l'intérieur du guard. Une liste d'exceptions cachée dans un guard est une liste que personne ne relit ; un décorateur est lu par quiconque lit la route.

### Ce que la chaîne a fait remonter

**`infrastructure/` ne doit pas importer `modules/`.** `@Public()` vivait dans `identity/authorization/` ; les contrôleurs `health` et `metrics` en avaient besoin. Le décorateur est transversal, sa place est `common/decorators/` — c'est là qu'il est désormais, avant qu'EVT-036 ne fasse de cette arête une règle appliquée.

**Trois suites e2e sondaient des routes sans session.** Les contrôleurs-sondes de `bootstrap/` et `logging/` testent le pipe de validation, l'enveloppe et le logger : les faire passer par la chaîne aurait fait dépendre ces tests d'une session et prouvé autre chose. Ils portent `@Public()`, avec la raison écrite au-dessus.

### 🟡 Rien n'incrémente encore `permissionsVersion` en production

Le test de révocation immédiate est passé au vert seulement après que le test lui-même incrémente le compteur. Ce n'est pas un échafaudage autour d'un défaut : c'est le contrat d'ADR-0004 — le compteur bouge **dans la transaction** qui change un rôle. Simplement, le use case qui possédera les deux moitiés est **EVT-044 (sprint 08)**, donc aucun appelant de `bumpMembership` n'existe encore.

Conséquence à connaître : **un rôle modifié directement en base est périmé jusqu'au TTL de 300 s.** Le mécanisme est construit et prouvé ; son point d'appel arrive avec la gestion des rôles.

### Structure livrée

```
common/decorators/public.decorator.ts          transversal, d'où common/
identity/authorization/decorators/             RequirePermission · RequireAuthLevel
                                               CurrentCaller · CurrentContext
identity/authorization/guards/                 authentication.guard · permissions.guard
identity/authorization/guard-chain.module.ts   l'ordre, en un seul endroit
identity/tenant-access/tenant-context.guard.ts étapes 4-5
identity/tenant-access/decorators/             AllowsOrganizationSwitch
```

`@RequireAuthLevel` compare des rangs, pas des égalités : une session `REAUTHENTICATED` satisfait une route qui demande `MFA`, parce qu'elle a prouvé **plus**, pas moins. Une égalité refuserait celui qui vient de ressaisir son mot de passe — le résultat le plus déroutant qu'un contrôle de sécurité puisse produire.

Les étapes 7 et 8 ne sont pas ici et ne peuvent pas l'être : les décider suppose de charger la ressource, ce qui est le travail du use case. Elles sont portées par des méthodes de repository qui **exigent** un `TenantContext`.

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
