# Sprint 03 — Base de données

> [← Sprint 02](../sprint-02/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 04 →](../sprint-04/README.md)

| | |
|---|---|
| **Tickets** | EVT-014 → EVT-019 |
| **Prérequis** | Sprint 02 |
| **Migrations** | **1, 2, 3, 8** |
| **Jalon** | 🏁 **M1 — Fondations** |

---

## Objectif

30 tables spécifiées, les premières migrations appliquées, un seed idempotent, et **l'audit opérationnel avant toute écriture métier**.

Invariant **O-3** : l'audit précède la première écriture métier. Une opération non tracée l'est **définitivement** — le trou ne se rattrape pas rétroactivement. C'est pourquoi la migration 8 est appliquée dans ce sprint malgré son rang.

## Critère de sortie

- `prisma migrate deploy` sur base vierge aboutit ;
- le seed est **idempotent** (deux exécutions ⇒ même état) ;
- les **12 invariants** ont chacun un test d'insertion qui **échoue** comme prévu ;
- `prisma migrate diff --exit-code` retourne 0.

---

## Tickets

| # | Titre | Migration |
|---|---|---|
| [EVT-014](#evt-014) | `schema.prisma` et modèles d'identité | 1, 2 |
| [EVT-015](#evt-015) | Modèles événementiels | 3 |
| [EVT-016](#evt-016) | Audit et security events | 8 |
| [EVT-017](#evt-017) | Seed rôles et permissions | — |
| [EVT-018](#evt-018) | Extension Prisma d'isolation tenant | — |
| [EVT-019](#evt-019) | Tests d'invariants | — |

---

## EVT-014 — `schema.prisma` et modèles d'identité
<a id="evt-014"></a>

> ✅ **Fait le 31 juillet 2026.** Les migrations 1 et 2 sont appliquées sur une base vierge, les 9 tables existent, et `prisma migrate diff --exit-code` retourne **0**. Chaque `CHECK`, chaque index partiel et chaque trigger est vérifié par un test d'intégration **contre PostgreSQL réel**.

```
Branche  feat/EVT-014-prisma-identity-schema
Commit   feat(db): add Prisma schema and identity core migrations
Tables   users, user_credentials, organizations, organization_memberships   (migration 1)
         roles, permissions, role_permissions,
         membership_role_assignments, platform_role_assignments             (migration 2)
```

### Structure livrée

```
backend/prisma.config.ts                        obligatoire en Prisma 7 (voir ci-dessous)
backend/prisma/schema.prisma                    9 modèles, aucun enum natif
backend/prisma/migrations/
├── 20260731154341_identity_core/migration.sql
└── 20260731154345_authorization_core/migration.sql
backend/src/infrastructure/database/
├── enums.ts                 valeurs autorisées, source unique
├── enums.spec.ts            18 tests de dérive schéma ↔ migrations
├── prisma.service.ts        client unique, adaptateur pg, connexion au boot
├── prisma.module.ts         @Global
├── transaction.manager.ts   runInTransaction
└── index.ts
backend/test/database/identity-schema.integration-spec.ts   12 tests contre PostgreSQL
```

### 🔴 Prisma 7 n'est pas le Prisma des versions précédentes

Ce que la mémoire d'un développeur — ou d'un agent — dicterait ici est **faux**. Vérifié en faisant générer à Prisma son propre échafaudage plutôt qu'en le supposant :

| Point | Prisma ≤ 6 | **Prisma 7.9** |
|---|---|---|
| URL de la datasource | `url = env("DATABASE_URL")` dans `schema.prisma` | **`prisma.config.ts`** — le bloc `datasource` n'a plus de champ `url` |
| Générateur | `prisma-client-js`, sortie dans `node_modules` | **`prisma-client`**, `output` **obligatoire** |
| Commande de seed | `package.json` → `prisma.seed` | **`prisma.config.ts`** → `migrations.seed` |
| Connexion du client | moteur natif intégré | **adaptateur obligatoire** (`@prisma/adapter-pg`) — « Query Compiler: enabled » |
| `migrate diff` | `--to-schema-datamodel`, `--shadow-database-url` | **`--to-schema`**, shadow DB depuis la config |

La commande de `MIGRATION_STRATEGY.md` §2 utilisait la syntaxe Prisma 5/6 : elle **échouait en affichant l'aide**, avec un code de sortie `1` qu'un CI aurait lu comme un échec du gate plutôt que comme une erreur de syntaxe. Corrigée dans le document et dans le script npm.

### Le `CREATE TYPE` que Prisma génère et que le §2.2 interdit

Prisma transforme un bloc `enum` en `CREATE TYPE … AS ENUM`. Le §2.2 l'interdit explicitement : on peut **ajouter** une valeur à un enum natif, pas en **retirer** une sans réécrire la table. Constaté en lisant la migration générée, pas supposé.

Les colonnes concernées sont donc `String` côté Prisma, `TEXT` + `CHECK` nommé côté base. Cela coûte la sécurité de type qu'un `enum` Prisma aurait donnée — récupérée dans `enums.ts`, qui déclare chaque ensemble **une seule fois**. Comme les valeurs vivent alors à deux endroits (TypeScript et SQL), `enums.spec.ts` lit les migrations et vérifie qu'elles coïncident : ajouter un statut d'un côté sans l'autre casse le build au lieu de produire une violation de contrainte en production.

### Trois défauts trouvés en exécutant

| Défaut | Comment trouvé | Correction |
|---|---|---|
| **Le client généré est ESM** — `import.meta.url`, que ce backend (CommonJS, pas de `"type": "module"`) ne peut pas charger : *« Cannot use 'import.meta' outside a module »* | la suite unitaire refusait de charger le client | `moduleFormat = "cjs"` sur le générateur |
| **Les imports générés utilisent des spécificateurs `.js`** pointant vers des fichiers `.ts` — convention NodeNext que TypeScript résout et que Jest ne résout pas | *« Cannot find module './internal/class.js' »* | `moduleNameMapper` dans les 3 configurations Jest |
| **Le compilateur de requêtes Prisma 7 est en WASM**, chargé par un `import()` dynamique que la VM CommonJS de Jest refuse | 34 tests e2e en échec dès que `AppModule` a inclus `PrismaModule` | `node --experimental-vm-modules` dans les scripts de test — il n'existe **pas** de runtime non-WASM en Prisma 7 |

Deux de mes propres tests étaient également faux et ont été corrigés : l'assertion « aucun enum natif » matchait **mon propre commentaire** expliquant qu'on n'en crée pas, et un `RegExp` avec le drapeau `/g` réutilisé entre appels `.test()` conservait `lastIndex` et sautait silencieusement des lignes.

### INV-09 est appliqué par la base, pas seulement par le code

Un rôle de portée `PLATFORM` accordé via `membership_role_assignments` donnerait une autorité plateforme à quiconque administre **une seule** organisation : c'est la voie d'escalade de privilège la plus directe du modèle. Le §5.6 exige un trigger, et la raison tient en une phrase — un invariant que seul le code applicatif maintient survit exactement jusqu'au premier script, à la première migration ou à la première session console qui contourne la couche service.

Deux triggers, dans les deux sens : `membership_role_assignments` n'accepte que `ORGANIZATION`, `platform_role_assignments` n'accepte que `PLATFORM`. Le second compte autant : sans lui, un rôle d'organisation pourrait être silencieusement élargi en l'insérant dans l'autre table.

### Vérification réelle, pas déclarative

Contre le PostgreSQL 18.4 de `docker-compose` :

| Scénario | Résultat observé |
|---|---|
| `prisma migrate deploy` sur base vierge | les 2 migrations appliquées, 9 tables créées |
| `prisma migrate diff --exit-code` | **« No difference detected », code 0** — critère de sortie du sprint |
| `status = 'NOT_A_STATUS'` | rejeté par `ck_users_status` |
| Second utilisateur avec le même email normalisé | rejeté par `ux_users_normalized_email_active` |
| **Même email après soft delete** | **accepté** — la raison d'être de l'index partiel |
| Rôle `PLATFORM` via un membership | rejeté, `INV-09` |
| Rôle `ORGANIZATION` dans `platform_role_assignments` | rejeté, `INV-09` |
| `UPDATE` échangeant un rôle pour une portée interdite | rejeté, `INV-09` |
| Re-attribution d'un rôle après révocation | acceptée — raison d'être de `WHERE revoked_at IS NULL` |
| Aucun `CREATE TYPE`, aucun `TIMESTAMP` sans `TZ` | vérifié par 18 tests lisant les migrations |

265 tests unitaires, 12 d'intégration, 34 e2e.

### Autres décisions

**Le client généré n'est pas committé** — dérivé de `schema.prisma`, spécifique à la plateforme, et la CI le régénère avant lint et typecheck. Il est aussi exclu d'ESLint : analyser une sortie machine produit des remarques que personne ne peut corriger.

**`DatabaseHealthIndicator` utilise désormais `PrismaService`** au lieu du pool `pg` privé d'EVT-012 — le `TODO(EVT-014)` est soldé. Deux configurations de connexion signifiaient qu'une readiness pouvait passer contre des réglages que l'application n'utilise pas.

**Limites assumées** — le seed (`prisma/seed/index.ts`) est le périmètre d'EVT-017 ; l'étape CI correspondante est gardée par `hashFiles` avec un `TODO`, car une étape verte qui n'assert rien est plus trompeuse qu'une étape sautée. Les 21 tables restantes suivent leurs sprints. L'extension Prisma d'isolation tenant est EVT-018 ; `TransactionManager` existe déjà pour lui donner un point d'accroche unique.

**État initial** — il n'existait **aucun** fichier `.prisma` dans le dépôt. Pas de `PrismaService`, pas de `PrismaClient` instancié, aucun script npm Prisma.

**Scope** — créer `backend/prisma/`, `PrismaService`, `PrismaModule`, `TransactionManager` ; migrations 1 et 2 ; les scripts npm de [`MIGRATION_STRATEGY.md` §2](../../database/MIGRATION_STRATEGY.md).

**Emplacement** — `prisma/` à la **racine de `backend/`**, pas sous `src/infrastructure/database/`. Prisma attend ce chemin par défaut. Le répertoire `src/infrastructure/database/migrations/` actuel, qui ne contient qu'un README de 107 octets, est supprimé.

**Référence** — [`DATABASE_SCHEMA.md` §4-5](../../database/DATABASE_SCHEMA.md).

**Conventions à respecter**

| Règle | |
|---|---|
| Identifiants | UUID v7 en `TEXT`, préfixes lisibles (`usr_`, `org_`, …). **Jamais** de `SERIAL` |
| Horodatages | `TIMESTAMPTZ`, jamais `TIMESTAMP` |
| Enums | `TEXT` + `CHECK`, pas `CREATE TYPE` — retirer une valeur d'un enum natif exige une réécriture de table |
| Index uniques sur table soft-delete | **partiels** : `WHERE deleted_at IS NULL` |

**Tests** — chaque `CHECK` rejette bien une valeur invalide (un `CHECK` non testé est un commentaire) ; les index uniques partiels autorisent la réutilisation d'une valeur après soft delete.

---

## EVT-015 — Modèles événementiels
<a id="evt-015"></a>

```
Branche  feat/EVT-015-events-schema
Commit   feat(db): add events, event sessions and assignments
Tables   events, event_sessions, event_user_assignments      (migration 3)
```

### `events` était une table fantôme

Le Document A la crée en migration 3, et **trois clés étrangères pointent dessus** (`event_user_assignments.event_id`, `scanner_device_assignments.event_id`, plus les invariants référençant `events.organization_id`). Elle n'a pourtant **aucune définition de colonne, aucun enum de statut, aucun index** nulle part dans le corpus. C'est la contradiction **C-10**.

Elle est définie intégralement dans [`DATABASE_SCHEMA.md` §6.1](../../database/DATABASE_SCHEMA.md).

**Points de conception à ne pas manquer**

| Point | Raison |
|---|---|
| `event_code` unique **globalement**, pas par organisation | un scanner le saisit **avant** que le tenant soit connu. 8 caractères Crockford base32, non prédictible |
| `timezone` obligatoire | les fenêtres de check-in se calculent dans le fuseau de l'événement, pas celui du serveur |
| `organization_id` **dénormalisé** sur `event_sessions` | permet à la garde Prisma de vérifier le scope **sans jointure**. Sans elle, la garde ne peut pas être universelle |
| `version` | verrou optimiste — un événement est édité concurremment par plusieurs administrateurs |

**Transitions** — `DRAFT → ACTIVE → EXPIRED`, `DRAFT|ACTIVE → CANCELLED`. `DRAFT → ACTIVE` exige **au moins une** `event_sessions`.

---

## EVT-016 — Audit et security events
<a id="evt-016"></a>

```
Branche  feat/EVT-016-audit-schema
Commit   feat(db): add audit logs and security events
Tables   security_events, audit_logs                          (migration 8)
```

### 🔴 Pourquoi cette migration est appliquée maintenant malgré son rang 8

Invariant **O-3**. Une opération métier non tracée l'est **définitivement** : on ne peut pas reconstruire rétroactivement qui a fait quoi. Si l'audit arrive au sprint 08, toutes les opérations des sprints 04 à 07 sont perdues pour l'analyse — y compris les créations de comptes et les assignations de rôles, c'est-à-dire précisément ce qu'un audit doit couvrir.

**Enum `event_type`** — union des **quatre catalogues concurrents** du corpus (contradiction **C-11**) : les 12 du Document A, les 23 du Document B, plus `SESSION_COMPROMISED`, `ROLE_ESCALATION_ATTEMPTED`, `RATE_LIMIT_EXCEEDED`, `ORGANIZATION_KILL_SWITCH_EXECUTED`, plus les codes nés des nouveaux domaines. Catalogue complet : [`AUTHENTICATION_AUTHORIZATION.md` §8](../../security/AUTHENTICATION_AUTHORIZATION.md).

**Règles**

| Règle | |
|---|---|
| `APPEND_ONLY` | aucun `UPDATE`, aucun `DELETE` applicatif |
| `audit_logs.actor_role` | **snapshot textuel** — le rôle au moment de l'action, insensible aux changements ultérieurs |
| `previous_values` / `new_values` | champs sensibles remplacés par `"[REDACTED]"`, **jamais omis** — l'omission masquerait le fait qu'ils ont changé |
| Rétention `security_events` | 12 mois. **Distincte** de celle de l'index de logs (contradiction C-15) |

---

## EVT-017 — Seed rôles et permissions
<a id="evt-017"></a>

```
Branche  feat/EVT-017-seed-authorization
Commit   feat(db): add idempotent authorization seed
```

**Scope** — `01-permissions.seed.ts` (~30 codes), `02-roles.seed.ts` (6 rôles système), `03-role-permissions.seed.ts` (matrice), `04-bootstrap-super-admin.seed.ts`.

**Portées de rôles fixées** — `SUPER_ADMIN → PLATFORM`, `CLIENT_ADMIN → ORGANIZATION`, **`SCANNER → EVENT`** ([ADR-0015](../../adr/0015-scanner-role-scope.md), résout C-17).

### 🔴 Aucun mot de passe n'est jamais écrit dans un seed

Y compris en développement. Un mot de passe de seed finit systématiquement en production.

Le problème d'amorçage est réel : l'invariant INV-10 exige qu'un `SUPER_ADMIN` actif existe toujours, INV-11 qu'il ait le MFA actif — une base vierge ne satisfait ni l'un ni l'autre. Procédure :

```
1  lire BOOTSTRAP_SUPER_ADMIN_EMAIL
2  créer l'utilisateur en status PENDING, SANS credentials
3  générer un token de vérification à usage unique
4  l'afficher UNE SEULE FOIS sur la sortie standard
5  l'administrateur définit son mot de passe et enrôle son MFA par le flux normal
6  passage à ACTIVE seulement après enrôlement MFA réussi
```

**Idempotence** — `upsert` sur `code`. Une permission retirée du catalogue n'est **pas supprimée** en base : elle est retirée de `role_permissions`, ce qui la rend inopérante tout en préservant l'intégrité des `audit_logs` qui la référencent.

**Rôles système** — `is_system = true` ⇒ **jamais** modifiable par une API. Toute évolution passe par une migration de seed, donc par une PR revue.

**Test** — exécuter `db:seed` deux fois produit exactement le même état.

---

## EVT-018 — Extension Prisma d'isolation tenant
<a id="evt-018"></a>

```
Branche  feat/EVT-018-tenant-scope-extension
Commit   feat(db): enforce tenant scope with a failing Prisma extension
```

**Scope** — `tenant-scope.extension.ts`, type `TenantContext`, `TenantScopeViolationError`, échappatoire `$unscoped` journalisée.

### Pourquoi ici et pas au sprint 06

La garde doit exister **avant le premier repository**. Chaque requête écrite sans elle devra être reprise. C'est l'invariant **O-5** appliqué au niveau du code : ajouter l'isolation après coup impose de réécrire tout ce qui a déjà été écrit.

```ts
if (TENANT_OWNED_MODELS.has(model) && !isUnscopedContext()) {
  if (!hasOrganizationScope(args))
    throw new TenantScopeViolationError(model, operation);
}
```

**Fail closed** — en cas de doute, on refuse. L'échappatoire `prisma.$unscoped(...)` est **unique et explicite**, réservée aux opérations plateforme, journalisée en `warn` avec `eventCode: UNSCOPED_QUERY_EXECUTED`, et **toute occurrence en production déclenche une alerte**.

**Signature de repository imposée**

```ts
findEventById(ctx: TenantContext, eventId: string)   // ✔ obligatoire
findEventById(eventId: string)                        // ✘ interdit
```

Le `TenantContext` est le **premier** paramètre, jamais optionnel, jamais un `string` nu — un `string` se passe par erreur, un type dédié ne se fabrique que par le guard.

**Test négatif** — une requête volontairement non scopée sur un modèle tenant-owned lève `TenantScopeViolationError`.

---

## EVT-019 — Tests d'invariants
<a id="evt-019"></a>

```
Branche  test/EVT-019-database-invariants
Commit   test(db): add failing-insert tests for all 12 cross-table invariants
```

**Scope** — un test par invariant INV-01 à INV-12 de [`DATABASE_SCHEMA.md` §9](../../database/DATABASE_SCHEMA.md). Chacun **doit échouer** à l'insertion.

| Invariant | Test |
|---|---|
| INV-01 | `event_user_assignments` avec un `organization_id` différent de celui de l'événement ⇒ rejeté |
| INV-04 | `event_sessions.organization_id` ≠ `events.organization_id` ⇒ rejeté |
| INV-09 | assigner un rôle `PLATFORM` dans `membership_role_assignments` ⇒ rejeté |
| INV-10 | révoquer le dernier `SUPER_ADMIN` actif ⇒ rejeté |
| INV-11 | assigner `SUPER_ADMIN` sans MFA `ACTIVE` ⇒ rejeté |
| INV-12 | `user_sessions` avec `organization_id` renseigné et `active_membership_id` nul ⇒ rejeté |

**Pourquoi par trigger et pas seulement en code** — un invariant qui ne repose que sur du code applicatif n'est pas un invariant. INV-09, INV-10 et INV-11 sont les trois voies les plus directes d'une escalade de privilège : elles ne doivent pas dépendre du seul chemin applicatif.

**Environnement** — tests d'intégration contre le **PostgreSQL réel** de docker-compose, jamais SQLite ni un mock. Une base différente ne teste pas les mêmes contraintes, et ce sont précisément les contraintes qu'on teste ici.

---

## 🏁 Jalon M1 — Fondations

À la fin de ce sprint, l'application **démarre, se configure, journalise, expose sa santé et persiste**. Elle n'a aucune feature. C'est normal et c'est le but : tout ce qui suit s'appuie dessus.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| Migration 8 repoussée « parce qu'elle est numérotée 8 » | O-3 documenté ici et dans la roadmap ; critère de sortie |
| `organization_id` oublié sur une table tenant-owned | EVT-018 : la garde lève à la première requête |
| Un mot de passe de test glissé dans le seed | Revue + `secret-scan` + règle explicite d'EVT-017 |
| Les triggers d'invariants jugés « trop lourds » | INV-09/10/11 sont les 3 chemins d'escalade de privilège les plus directs |
| `CHECK` écrits mais non testés | EVT-019 : un `CHECK` non testé est un commentaire |
