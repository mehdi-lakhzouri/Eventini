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

> ✅ **Fait le 31 juillet 2026.** Migration 3 appliquée, la table fantôme **C-10 est résolue**, et INV-01 comme INV-04 sont appliqués par trigger et vérifiés contre PostgreSQL réel. `prisma migrate diff --exit-code` reste à **0**.

```
Branche  feat/EVT-015-events-schema
Commit   feat(db): add events, event sessions and assignments
Tables   events, event_sessions, event_user_assignments      (migration 3)
```

### Structure livrée

```
backend/prisma/migrations/20260731162915_events_core/migration.sql
backend/src/infrastructure/database/enums.ts      + 5 ensembles, + 5 CHECK
backend/src/modules/events/domain/
├── event-code.ts              génération Crockford base32, CSPRNG
├── event-code.spec.ts
├── event-transitions.ts       la machine à états, en données
└── event-transitions.spec.ts
backend/test/database/events-schema.integration-spec.ts   18 tests
```

### `event_code` — pourquoi l'unicité globale n'est *pas* une entorse au tenant-first

C'est l'inverse d'une entorse. Le scanner saisit ce code **avant que le tenant soit connu** : c'est lui qui *résout* le tenant. D'où deux conséquences que le code applique littéralement :

- il est unique **globalement** (`ux_events_event_code_active`, partiel sur `deleted_at`) ;
- il doit être **imprévisible**. Un code séquentiel laisserait n'importe qui lier un scanner à l'événement d'une autre organisation — une brèche inter-tenant atteignable depuis l'écran de connexion d'un appareil.

`generateEventCode` tire donc de `node:crypto`, pas de `Math.random`. Elle utilise `randomInt` plutôt que `randomBytes(1)[0] % 32` : ce modulo n'est non biaisé que parce que 256 est divisible par 32, accident qui cesse dès qu'on touche à l'alphabet. Crockford base32 exclut `I`, `L`, `O` et `U` — les trois premiers parce qu'ils se confondent avec `1` et `0` dans la plupart des polices, le dernier pour éviter les grossièretés involontaires. Cela compte ici plus qu'ailleurs : le code est lu sur une feuille imprimée et tapé par quelqu'un debout à l'entrée d'un lieu.

L'unicité reste garantie par l'index, jamais supposée par le générateur : un générateur qui ne collisionne que *probablement* est un générateur qui collisionne en production.

### La machine à états, écrite en données

`DRAFT → ACTIVE → EXPIRED`, `DRAFT|ACTIVE → CANCELLED`, **aucun retour**. Déclarée comme une table de transitions plutôt qu'une cascade de `if`, ce qui permet de l'asserter exhaustivement : chaque paire de statuts est soit listée, soit refusée, sans troisième possibilité.

`EXPIRED` et `CANCELLED` sont terminaux **par conception** : billets, présences et rapports dérivent tous du fait que l'événement a atteint un état terminal ; rouvrir laisserait ces artefacts décrire un état que l'événement n'a plus. Un événement annulé qui doit se tenir malgré tout est un **nouvel** événement.

`DRAFT → ACTIVE` exige au moins une session. Un événement actif sans session n'est pas un événement diminué, c'est un événement cassé : le check-in se résout contre les sessions, donc **chaque scan échouerait à la porte** sans que rien dans les données ne l'explique. La fonction retourne un motif, pas un booléen — sinon chaque appelant réinvente le message et ils divergent.

### INV-01 et INV-04 — la dénormalisation n'est valable que si la copie est vraie

`organization_id` est dénormalisé sur `event_sessions` et `event_user_assignments`. Ce n'est pas une optimisation (§2.4) : c'est ce qui permet à la garde d'isolation d'EVT-018 de vérifier le scope **sans jointure**. Sans cette colonne la garde devrait comprendre le graphe relationnel, donc serait partielle, donc contournable.

Mais cela ne tient que tant que la copie est exacte — donc elle est **appliquée**, pas supposée :

- **INV-04** — `event_sessions.organization_id` = `events.organization_id`. Une session dont le tenant diverge de son événement serait visible par le mauvais tenant, par le mécanisme même censé l'empêcher.
- **INV-01** — l'assignation doit correspondre **à la fois** à `events.organization_id` **et** à `organization_memberships.organization_id`. Les deux comparaisons comptent : ne vérifier que l'événement laisserait affecter le membre d'une autre organisation ; ne vérifier que le membership laisserait affecter un membre d'ici à l'événement d'un autre tenant. Chacune seule est une attribution inter-tenant.

Les deux triggers couvrent aussi l'`UPDATE`, pas seulement l'`INSERT` : déplacer une ligne existante vers un autre tenant est le même trou.

### `assignment_type` n'est pas du texte libre

`ENTITY_RELATIONSHIPS.md` §4.4 résout les permissions d'événement en joignant `assignment_type` sur `roles.code` où `roles.scope = 'EVENT'`. Une valeur sans rôle correspondant n'accorde donc **rien, silencieusement**. Les deux ensembles sont alignés dans `enums.ts`, et le seed d'EVT-017 crée exactement ces codes de rôle.

### Une contrainte ajoutée au-delà du document

`ck_event_assignments_validity_order` — le §6.3 définit le sens de la fenêtre `valid_from` / `valid_until` sans imposer de contrainte. Une assignation dont la validité se termine avant de commencer n'accorde rien à aucun instant : elle ne peut être qu'une erreur de saisie. La refuser ne coûte rien et évite qu'une permission inerte paraisse accordée dans l'interface. Signalée ici comme un ajout, pas comme une lecture du document.

### Vérification réelle, pas déclarative

| Scénario | Résultat observé |
|---|---|
| `prisma migrate deploy` sur base vierge | les 3 migrations appliquées |
| `prisma migrate diff --exit-code` | **0** |
| Événement finissant avant de commencer | rejeté, `ck_events_date_order` |
| Fenêtre de check-in fermée avant ouverture | rejeté, `ck_events_checkin_window` |
| Fenêtre semi-ouverte (« suit l'événement ») | **acceptée** |
| Même `slug` dans **deux** organisations | **accepté** — le slug est par tenant |
| Même `slug` dans la **même** organisation | rejeté, `ux_events_org_slug_active` |
| Même `event_code` dans une **autre** organisation | **rejeté** — l'unicité est globale |
| Même `event_code` après soft delete | **accepté** |
| Session dont le tenant diverge de son événement | rejeté, `INV-04` |
| `UPDATE` déplaçant une session vers un autre tenant | rejeté, `INV-04` |
| Assignation dont le tenant diverge de l'événement | rejeté, `INV-01` |
| Membership d'une autre organisation sur cet événement | rejeté, `INV-01` |
| Ré-assignation après révocation | **acceptée** |

322 tests unitaires (dont 47 pour le domaine événementiel), 30 d'intégration, 34 e2e.

**Limites assumées** — la règle « `DRAFT → ACTIVE` exige une session » vit dans le domaine, pas dans un trigger : elle porte sur un agrégat (le nombre de sessions non supprimées) et l'imposer en base demanderait un trigger de comptage à chaque écriture de session, coûteux et contournable par une session supprimée dans la même transaction. Elle sera appliquée par le use case d'activation (sprint 09) ; les tests couvrent la décision, pas encore son point d'application. `scanner_device_assignments`, qui référence `event_sessions`, arrive en migration 7 (sprint 11).

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

> ✅ **Fait le 31 juillet 2026.** Migration 8 appliquée, **C-11 résolue** (34 codes, union des quatre catalogues), et l'`APPEND_ONLY` est appliqué **par trigger** — un `UPDATE` ou un `DELETE` applicatif échoue, vérifié contre PostgreSQL réel.

```
Branche  feat/EVT-016-audit-schema
Commit   feat(db): add audit logs and security events
Tables   security_events, audit_logs                          (migration 8)
```

### Structure livrée

```
backend/prisma/migrations/20260731193504_audit_and_security/migration.sql
backend/src/infrastructure/database/enums.ts     + 34 types, 5 sévérités, 3 résultats
backend/src/infrastructure/audit/
├── audit-redaction.ts     remplace la valeur, ne supprime JAMAIS la clé
├── audit-redaction.spec.ts
└── index.ts
backend/test/database/audit-schema.integration-spec.ts   21 tests
```

### `APPEND_ONLY` est une contrainte, pas une convention

Le ticket dit « aucun `UPDATE`, aucun `DELETE` applicatif ». Laisser cela à la discipline annulerait l'intérêt des deux tables : **une piste d'audit que l'application peut réécrire ne prouve rien**, et la première personne à vouloir la réécrire est celle qu'elle incrimine. Deux triggers l'imposent, donc un `UPDATE` égaré, un mauvais usage de l'ORM, une migration ou une session console échouent tous de la même façon.

**L'échappatoire de rétention, et pourquoi c'est un drapeau de session.** `security_events` est conservée 12 mois (§8.1) : la suppression doit donc être possible pour la purge et impossible pour tout le reste. Le drapeau est un réglage **local à la transaction** (`SET LOCAL eventini.retention_purge`) plutôt qu'un rôle PostgreSQL distinct — un rôle devrait être accordé quelque part et deviendrait utilisable par tout ce qui détient ces identifiants, alors qu'un `SET LOCAL` **ne peut pas survivre à sa transaction** et ne peut pas être activé par accident. Le job de purge déclare son intention dans la même transaction que la suppression ; rien d'autre ne nomme ce drapeau. Un test vérifie explicitement que le drapeau **ne fuit pas** vers la transaction suivante sur la même connexion du pool.

### `[REDACTED]`, jamais l'omission — et pourquoi ce n'est pas le scrubber des logs

Le §8.2 est explicite : *« les champs sensibles sont remplacés par `[REDACTED]`, jamais omis — l'omission masquerait le fait qu'ils ont changé. »*

C'est l'inverse de la règle du logging. Là-bas, supprimer un champ est un résultat parfaitement acceptable : l'objectif est que le secret n'atteigne pas le magasin de logs. Ici la question posée est « **qu'est-ce qui a changé** ». Si un hash de mot de passe disparaît de `previous_values` et `new_values`, la ligne affirme que le mot de passe **n'a pas changé** — exactement à l'envers, et exactement ce que quelqu'un effaçant ses traces voudrait qu'elle dise.

Les deux fonctions se ressemblent et signifient le contraire, ce qui rendait la réutilisation de `scrubSensitiveKeys` plausible et fausse : elle censure aussi les valeurs, mais son contrat autorise l'omission et son marqueur diffère (`[Redacted]` contre `[REDACTED]`). **Seule la liste de clés est partagée**, c'est-à-dire la partie qui ne doit effectivement pas diverger. `buildAuditDiff` redacte les deux côtés avec les mêmes règles : n'en traiter qu'un laisserait fuiter la valeur tout en donnant à la ligne l'apparence d'être redactée.

### `actor_role` est un instantané textuel, pas une clé étrangère

Une FK ferait **changer la piste d'audit rétroactivement** quand un rôle est renommé, révoqué ou supprimé : l'enregistrement de ce qu'une personne était autorisée à faire serait réécrit par des événements postérieurs. Une piste d'audit qui change après coup n'en est pas une. Un test insère `'A_ROLE_THAT_NO_LONGER_EXISTS'` et vérifie qu'il est conservé tel quel.

### C-11 — les quatre catalogues, réunis

34 codes sur 9 domaines, union des 12 du Document A, des 23 du Document B, et des codes nés des nouveaux domaines. Le Document D exigeait d'enregistrer des types que le plus étroit de ces enums ne pouvait pas stocker : une liste partielle aurait donc **silencieusement perdu précisément les événements qui comptent**.

`DENIED` est distinct de `FAILURE` à dessein — un échec est une tentative qui n'a pas fonctionné, un refus est une tentative rejetée par la politique. Les confondre rend « combien de personnes ont été bloquées par l'autorisation » impossible à répondre.

**Deux espaces de noms, non synchronisés.** `SECURITY_EVENT_TYPES` et `LOG_EVENT_CODES` (EVT-011) partagent des chaînes (`LOGIN_FAILED`, `ROLE_CHANGED`) sans aucune relation, comme le §10 du Document D l'exige : l'un est une ligne dans un magasin de logs conservée quelques semaines, l'autre une ligne PostgreSQL conservée douze mois et traitée comme une **preuve**. Confondre les deux rétentions est la contradiction **C-15**.

### Vérification réelle, pas déclarative

| Scénario | Résultat observé |
|---|---|
| `prisma migrate deploy` sur base vierge | les 4 migrations appliquées |
| `prisma migrate diff --exit-code` | **0** |
| `UPDATE` d'un `security_events` | rejeté, `APPEND_ONLY` |
| `DELETE` hors purge | rejeté, `APPEND_ONLY` |
| `UPDATE` d'un `audit_logs` | rejeté, `APPEND_ONLY` |
| Mise à `NULL` d'une seule colonne d'audit | rejeté — la façon subtile de falsifier |
| `DELETE` dans une transaction déclarant la purge | **accepté**, 1 ligne |
| Le drapeau de purge après `COMMIT` | **expiré** — le `DELETE` suivant échoue |
| `INSERT` | toujours accepté |
| `event_type` hors catalogue | rejeté, `ck_security_events_type` |
| Les 5 codes ajoutés par C-11 testés | acceptés |
| `actor_role` d'un rôle disparu | conservé tel quel |
| Secret modifié via `buildAuditDiff` | ni l'ancienne ni la nouvelle valeur présentes, **la clé oui** |

354 tests unitaires (dont 23 pour la redaction d'audit), 51 d'intégration, 34 e2e.

**Limites assumées** — la purge de rétention à 12 mois n'est pas planifiée : le mécanisme existe et est testé, le job qui l'appelle relève de l'exploitation (§34 du Document D) et n'a pas de ticket dans ce sprint. `metadata` n'a pas d'index GIN, conformément au §10 qui n'en ajoute que sur un besoin de requête mesuré. Les triggers `APPEND_ONLY` protègent contre l'application ; ils ne protègent pas contre un superutilisateur PostgreSQL, ce qui relève des privilèges de base et non du schéma.

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

> ✅ **Fait le 31 juillet 2026.** 30 permissions, 6 rôles système et 52 attributions écrits en base réelle. `db:seed` exécuté deux fois produit un état **identique octet pour octet**, `updated_at` compris. Aucune ligne n'est écrite dans `user_credentials` — vérifié par un test et par une garde CI bloquante.

```
Branche  feat/EVT-017-seed-authorization
Commit   feat(db): add idempotent authorization seed
```

### Structure livrée

```
backend/prisma/seed/
├── authorization-catalogue.ts       30 permissions, 6 rôles, la matrice
├── seed-client.ts                   PrismaClient hors Nest
├── seed-outcome.ts                  compteurs created/updated/unchanged/removed
├── 01-permissions.seed.ts
├── 02-roles.seed.ts
├── 03-role-permissions.seed.ts
├── 04-bootstrap-super-admin.seed.ts
└── index.ts                         orchestrateur, --assert-no-op
backend/src/infrastructure/database/
├── uuid-v7.ts        + spec         RFC 9562 §5.7, implémenté ici (voir plus bas)
├── identifiers.ts    + spec         19 préfixes, newId(), hasPrefix()
├── normalize-email.ts + spec        la définition de normalized_email
└── authorization-catalogue.spec.ts  26 tests de cohérence du catalogue
backend/test/database/seed.integration-spec.ts   19 tests contre PostgreSQL
```

### 🔴 La matrice rôle × permission est **dérivée**, pas citée

Le [`MIGRATION_STRATEGY.md` §8.1](../../database/MIGRATION_STRATEGY.md) nomme les six rôles et demande « la matrice rôle × permission » **sans jamais l'énoncer**. Elle n'existe nulle part dans le corpus. Les 52 attributions sont donc lues sur les responsabilités d'[`EVENTINI_PROJECT_CONTEXT.md` §6.1–6.3](../../00-project-context/EVENTINI_PROJECT_CONTEXT.md) et d'[ADR-0015](../../adr/0015-scanner-role-scope.md), chaque décision non évidente étant justifiée en commentaire à côté de la ligne concernée.

**C'est la partie de ce ticket qui mérite le plus une relecture humaine** : une case fausse ici est une sur-attribution silencieuse, qui ne produit aucune erreur — seulement une permission accordée à quelqu'un qui ne devrait pas l'avoir.

Les trois arbitrages qui ne se déduisent pas mécaniquement :

| Décision | Raison |
|---|---|
| `SUPER_ADMIN` n'a **aucune** permission métier | §6.1 : « un super admin ne doit pas utiliser les mêmes routes métier qu'un client admin sans contexte clair ». Lui accorder `events.update` rendrait cette règle inapplicable **plus tard**, puisque le contrôle passerait déjà. L'accès au tenant se fait par `platform.users.impersonate`, qui est audité |
| `CLIENT_ADMIN` n'a **aucun** `attendance.*` | ADR-0015 : le pointage est toujours de portée `EVENT`. Un administrateur qui doit pointer reçoit une affectation d'événement — visible, bornée, révocable — au lieu d'un droit à l'échelle de l'organisation |
| `SCANNER` n'a **pas** `attendance.override` | L'override est le moyen de forcer un scan refusé. §6.3 est explicite : l'opérateur n'effectue **aucune modification libre**. Qui doit forcer détient `EVENT_ADMIN` |

`SCANNER` reçoit en revanche `registrations.read`, parce que §6.3 exige qu'il puisse « consulter le résultat de validation » : sans cela un scan serait accepté sans être explicable, et l'opérateur ne pourrait pas distinguer un billet valide d'un billet inconnu.

### `upsert` aurait été le mauvais primitif

C'est pourtant ce que demande le §8.1, et c'est la première chose qu'on écrit. `Permission.updatedAt` porte `@updatedAt` : un `upsert` inconditionnel réécrit l'horodatage des 30 lignes **à chaque exécution** — chaque déploiement, chaque job CI. Les lignes seraient identiques en contenu et différentes sur disque, ce qui coûte deux choses :

- « quand cette permission a-t-elle changé pour la dernière fois ? » devient sans réponse ;
- le test du ticket — deux exécutions, même état — cesse d'être **littéralement** vrai.

Chaque étape lit donc avant d'écrire et ne modifie que ce qui diffère réellement. C'est ce qui permet à la seconde exécution d'afficher `created: 0, updated: 0` — une affirmation qu'une étape CI peut vérifier, au lieu d'une qu'il faut croire.

```
step                     created    updated  unchanged    removed
-----------------------------------------------------------------
permissions                    0          0         30          0
roles                          0          0          6          0
role_permissions               0          0         52          0
bootstrap_super_admin          0          0          2          0

  Nothing changed — the database already matches the catalogue.
```

### L'asymétrie suppression : deux règles opposées, volontairement

| Table | Règle | Pourquoi |
|---|---|---|
| `permissions`, `roles` | **jamais** de suppression | une entrée retirée du catalogue reste en base : les `audit_logs` la référencent, et supprimer la ligne ferait pointer une entrée d'audit vers le vide — exactement au moment où quelqu'un la consulte |
| `role_permissions` | **réconciliation exacte**, suppressions comprises | une permission retirée d'un rôle doit réellement cesser de fonctionner. Garder la ligne « pour l'historique » ferait du seed un mécanisme qui accorde sans jamais retirer : un cliquet à sens unique sur le privilège. L'historique vit dans `audit_logs`, qui est append-only ; la table de jointure est l'**état courant**, et un état courant a le droit de diminuer |

La passe de suppression balaie **toute** la table, pas seulement les rôles du catalogue : un rôle retiré du catalogue se retrouve donc sans aucune permission.

### Les étapes 3 et 4 de la procédure d'amorçage ne sont **pas** implémentées

`email_verification_tokens` n'existe pas encore — c'est la migration 4, livrée par [EVT-021](../sprint-04/README.md#evt-021). Il n'y a aucune table où persister un token à usage unique.

Un token affiché ici serait donc une chaîne que **rien ne pourrait jamais vérifier** : pire que pas de token du tout, parce qu'il ressemble à un identifiant valide, qu'il serait collé dans un navigateur, qu'il échouerait sans explication, et qu'il inviterait quelqu'un à « réparer » l'amorçage en écrivant un mot de passe après tout.

Le compte est donc créé `PENDING`, sans credentials, avec son attribution `SUPER_ADMIN` déjà active, et la sortie standard dit exactement ce qui reste à faire :

```
A platform administrator account was created and CANNOT SIGN IN YET.

  email   …
  id      usr_019fb9d8-…
  status  PENDING, with no password and no MFA

No password was written, deliberately: a seeded password reaches
production every time. …
```

C'est l'état de repos correct, pas un état cassé : un compte qui ne peut pas s'authentifier ne peut pas non plus se faire compromettre.

### Deux gardes ajoutées à la CI

| Garde | Ce qu'elle empêche |
|---|---|
| `npm run db:seed -- --assert-no-op` | l'étape « Seed is idempotent » exécutait la commande **deux fois sans lire aucun code de sortie** — elle ne prouvait que l'absence de crash. Le drapeau fait échouer la seconde exécution si quoi que ce soit a été écrit. Le garde `hashFiles` est retiré |
| `No credential written by a seed` (bloquante) | un `grep` sur `passwordHash`, `argon2`, `user_credentials`… dans `prisma/seed`. Les lignes de commentaire sont retirées d'abord : sinon le contrôle matche **sa propre justification** dans `04-bootstrap-super-admin.seed.ts`, et un scanner qui se déclenche sur son propre argumentaire apprend aux gens à le désactiver |

### Quatre choses trouvées en exécutant

| Constat | Comment trouvé | Correction |
|---|---|---|
| **`uuid` est ESM-only** et Jest ne transforme pas `node_modules` — `transformIgnorePatterns` n'y change rien, `transform` ne matchant que `.ts` | la suite unitaire refusait de charger le paquet | `uuid-v7.ts`, implémenté sur `node:crypto`. Ce qui est écrit est une **disposition d'octets**, pas une primitive : toute l'entropie vient de `randomBytes`. Le paquet `uuid` est retiré des dépendances |
| **Le client généré importait en `./x.js`** — convention NodeNext que TypeScript résout et que le résolveur CommonJS de Node ne résout pas | `ts-node prisma/seed/index.ts` : `Cannot find module './internal/class.js'` | `importFileExtension = ""` sur le générateur. Cela supprime aussi le `moduleNameMapper` qui masquait le problème dans **trois** configurations Jest |
| **`prisma/` n'était ni typé, ni linté** : `tsconfig.json` et les globs npm ne couvraient que `src/` et `test/` | en cherchant pourquoi le seed n'apparaissait dans aucun rapport | `prisma/**/*.ts` ajouté à `include`, à `lint` et à `format`. `tsconfig.build.json` garde son propre `include`, donc le seed ne part **pas** dans `dist/` |
| **Un de mes propres tests était faux** : il comparait les codes de permission triés par PostgreSQL à ceux triés par JavaScript. Le `_` ne se classe pas au même endroit sous la collation de la base et sous la comparaison par point de code — `event_sessions.manage` et `events.create` s'échangent | le test échouait sur une différence qui ne disait rien du seed | comparaison ensembliste, avec la raison en commentaire |

### Un préfixe d'identifiant ajouté au §2.1

La liste de [`DATABASE_SCHEMA.md` §2.1](../../database/DATABASE_SCHEMA.md) couvre les identifiants « exposés dans une API ou une URL » et ne nomme rien pour les trois tables d'affectation. `asg_` est donc ajouté, et signalé comme tel : réutiliser `rol_` mettrait un préfixe de rôle sur une ligne qui n'en est pas un, et l'omettre ferait de ces tables les seules à porter un UUID nu — donc des exceptions à connaître par cœur pour lire une ligne de log.

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
