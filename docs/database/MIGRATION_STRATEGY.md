# Eventini — Stratégie de migration de base de données

> **Statut :** Spécification normative · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Outil :** Prisma Migrate 7.9 · **Cible :** PostgreSQL 18.4
> **Complète :** [`DATABASE_SCHEMA.md`](DATABASE_SCHEMA.md) — §12 donne l'ordre des 14 migrations

---

## 1. État actuel

| Élément | État vérifié au 30 juillet 2026 |
|---|---|
| `schema.prisma` | **inexistant** — `find . -name "*.prisma"` ne retourne aucun résultat |
| `prisma/migrations/` | **inexistant** |
| Seed | **inexistant** — aucun fichier, aucune clé `prisma.seed` dans `package.json` |
| `PrismaService` / `PrismaModule` | **inexistants** — aucun `PrismaClient` instancié dans `backend/src` |
| Scripts npm Prisma | **inexistants** — `package.json` contient les scripts NestJS par défaut, non modifiés |
| `backend/src/infrastructure/database/migrations/` | contient un `README.md` de 107 octets, sans migration |
| `DATABASE_URL` | **défini nulle part** — il n'existe aucun `.env` backend |

Le Document A §11 donne un ordre de création en 8 étapes. **C'est la seule stratégie de migration existante dans tout le corpus.** Aucune convention de nommage, aucune règle de zéro-interruption, aucune procédure de rollback, aucune stratégie de seed n'existe.

Ce document comble ce manque.

---

## 2. Emplacement et outillage

```
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   │   ├── 20260801120000_identity_core/migration.sql
│   │   └── …
│   └── seed/
│       ├── index.ts
│       ├── 01-permissions.seed.ts
│       ├── 02-roles.seed.ts
│       ├── 03-role-permissions.seed.ts
│       └── 04-bootstrap-super-admin.seed.ts
```

`prisma/` à la racine de `backend/`, **pas** sous `src/infrastructure/database/`. Prisma attend ce chemin par défaut ; le placer ailleurs impose une configuration supplémentaire sans bénéfice. Le répertoire `src/infrastructure/database/migrations/` actuel, qui ne contient qu'un README, est supprimé au sprint 03.

**Scripts npm à ajouter** — aucun n'existe aujourd'hui :

```json
"prisma:generate":     "prisma generate",
"prisma:migrate:dev":  "prisma migrate dev",
"prisma:migrate:deploy": "prisma migrate deploy",
"prisma:migrate:diff": "prisma migrate diff --from-migrations ./prisma/migrations --to-schema ./prisma/schema.prisma --exit-code",
"prisma:studio":       "prisma studio",
"db:seed":             "ts-node prisma/seed/index.ts",
"db:reset":            "prisma migrate reset --force"
```

`prisma:migrate:diff` avec `--exit-code` est le **gate CI** : il échoue si `schema.prisma` et les migrations divergent, c'est-à-dire si quelqu'un a modifié le schéma sans générer la migration correspondante.

> **Corrigé au sprint 03 (EVT-014).** La commande initialement écrite ici utilisait `--to-schema-datamodel` et `--shadow-database-url`, deux drapeaux de Prisma 5/6 : le premier s'appelle `--to-schema` en Prisma 7, le second n'existe plus — l'URL de shadow database vient désormais de `prisma.config.ts`. La commande d'origine échouait en affichant l'aide, avec un code de sortie `1` qu'un CI aurait interprété comme un échec du gate plutôt que comme une erreur de syntaxe.

**`prisma.config.ts` est obligatoire en Prisma 7.** Le bloc `datasource` de `schema.prisma` ne porte plus d'`url` : `env("DATABASE_URL")` n'y est plus le mécanisme. Le fichier de configuration à la racine de `backend/` fournit `datasource.url`, `datasource.shadowDatabaseUrl`, le chemin des migrations et la commande de seed — cette dernière ayant elle aussi quitté `package.json`.

---

## 3. Convention de nommage

```
<horodatage>_<domaine>_<action>
20260801120000_identity_core
20260815093000_events_add_check_in_window
20260901140000_attendance_backfill_organization_id
```

| Règle | |
|---|---|
| Horodatage | généré par Prisma, jamais édité à la main |
| Domaine | `identity`, `authorization`, `events`, `participants`, `registrations`, `tickets`, `attendance`, `audit`, `idempotency`, `outbox` |
| Action | `core`, `add_x`, `drop_x`, `rename_x_to_y`, `backfill_x`, `index_x`, `constraint_x` |
| Langue | anglais ([ADR-0001](../adr/0001-documentation-language.md)) |
| Portée | **une intention par migration** — ne jamais mélanger une création de table et un backfill |

---

## 4. Règle absolue : les migrations appliquées sont immuables

Une migration présente dans `_prisma_migrations` d'un environnement quelconque n'est **jamais** modifiée. Jamais son SQL, jamais son nom, jamais son horodatage.

Une erreur se corrige par une **migration suivante**. Éditer une migration déjà appliquée produit une divergence de checksum, que Prisma détecte, et laisse chaque environnement dans un état différent selon sa date de déploiement.

Seule exception, encadrée : une migration créée localement, **jamais poussée**, jamais appliquée ailleurs que sur la base de développement de son auteur.

---

## 5. Expand / contract — changements sans interruption

Tout changement destructeur ou incompatible se déroule en **trois déploiements**. C'est ce qui permet à l'ancienne et à la nouvelle version du code de coexister pendant un déploiement progressif.

```
Déploiement 1 — EXPAND     ajouter le nouveau, sans rien retirer
Déploiement 2 — MIGRATE    l'application écrit dans les deux, backfill de l'existant
Déploiement 3 — CONTRACT   retirer l'ancien, une fois plus aucun code ne le lit
```

### Renommer une colonne

| Étape | Migration | Code |
|---|---|---|
| 1 | `ADD COLUMN new_name`, nullable | écrit dans les deux, lit `old_name` |
| 2 | `UPDATE … SET new_name = old_name WHERE new_name IS NULL`, par lots | lit `new_name` avec repli sur `old_name` |
| 3 | `SET NOT NULL`, puis `DROP COLUMN old_name` | ne connaît plus que `new_name` |

`ALTER TABLE … RENAME COLUMN` en une passe est interdit : il casse instantanément toute instance de l'ancienne version encore en vol.

### Rendre une colonne obligatoire

1. Ajouter nullable · 2. Backfill par lots · 3. `SET NOT NULL` uniquement après vérification `COUNT(*) WHERE col IS NULL = 0`.

### Ajouter un index sur une table volumineuse

```sql
CREATE INDEX CONCURRENTLY ix_attendance_org_event_time
  ON attendance_records (organization_id, event_id, server_recorded_at DESC);
```

`CONCURRENTLY` ne prend pas de verrou en écriture. Contrepartie : il ne peut pas s'exécuter dans une transaction, donc dans une migration Prisma il faut `-- prisma:no-transaction` en tête de fichier. Un `CREATE INDEX` ordinaire sur `attendance_records` en plein événement bloquerait tous les check-ins.

### Ajouter une contrainte

```sql
ALTER TABLE events ADD CONSTRAINT ck_events_date_order
  CHECK (starts_at < ends_at) NOT VALID;
ALTER TABLE events VALIDATE CONSTRAINT ck_events_date_order;
```

`NOT VALID` puis `VALIDATE` : la première commande est instantanée et s'applique aux nouvelles lignes ; la seconde vérifie l'existant sans verrou exclusif.

### Backfill

Toujours **par lots**, jamais en un `UPDATE` global :

```sql
UPDATE attendance_records SET organization_id = e.organization_id
FROM events e
WHERE attendance_records.event_id = e.id
  AND attendance_records.organization_id IS NULL
  AND attendance_records.id IN (
    SELECT id FROM attendance_records WHERE organization_id IS NULL LIMIT 5000
  );
```

Répété jusqu'à `0 rows`. Un `UPDATE` global sur une grande table tient un verrou et fait exploser le WAL.

---

## 6. Procédure par migration

Aucune migration n'est fusionnée sans ces 8 étapes. Elles reprennent et étendent le gate en 6 points du Document A §11.

| # | Étape | Preuve attendue |
|---|---|---|
| 1 | **Schéma** — `schema.prisma` modifié, revu | diff dans la PR |
| 2 | **Génération** — `prisma migrate dev --create-only`, SQL relu à la main | le SQL généré est dans la PR |
| 3 | **Clés étrangères** — toutes présentes, `ON DELETE` explicite et conforme à [`ENTITY_RELATIONSHIPS.md` §5](ENTITY_RELATIONSHIPS.md) | revue |
| 4 | **Index** — tenant-first, partiels là où requis, nommés `ux_`/`ix_` | revue |
| 5 | **Contraintes** — `CHECK` des enums et des invariants | revue |
| 6 | **Rollback** — un `down.sql` manuel existe, ou l'irréversibilité est documentée et assumée | fichier ou note |
| 7 | **Tests d'intégration** — passent sur une base réelle, pas un mock | sortie CI |
| 8 | **Plans de requête** — `EXPLAIN ANALYZE` des requêtes de la chaîne d'autorisation, aucun `Seq Scan` sur table tenant | sortie collée dans la PR |

L'étape 8 n'est pas une optimisation prématurée : un `Seq Scan` sur `attendance_records` pendant un événement à fort volume est un incident de production, pas une lenteur.

---

## 7. Rollback

Prisma Migrate ne génère pas de `down`. La stratégie est explicite.

| Type de migration | Réversibilité | Procédure |
|---|---|---|
| `CREATE TABLE` | totale | `DROP TABLE` |
| `ADD COLUMN` nullable | totale | `DROP COLUMN` |
| `CREATE INDEX` | totale | `DROP INDEX CONCURRENTLY` |
| `ADD CONSTRAINT` | totale | `DROP CONSTRAINT` |
| `DROP COLUMN` | **irréversible** | uniquement en phase CONTRACT, après vérification |
| Backfill | **irréversible** | l'état antérieur n'est pas reconstituable |
| Changement de type | partielle | seulement si la conversion inverse ne perd rien |

**En production, le rollback par défaut n'est pas une migration inverse : c'est une restauration `point-in-time`.** Un `down.sql` est fourni quand il est trivialement correct, jamais quand il donnerait une fausse impression de réversibilité.

Prérequis avant toute migration en production :

1. sauvegarde vérifiée immédiatement avant ;
2. `point-in-time recovery` activé et testé ;
3. migration appliquée d'abord en staging sur une copie anonymisée de la production ;
4. fenêtre de déploiement hors période d'événement actif — vérifiée par requête, pas par supposition :

```sql
SELECT count(*) FROM events
WHERE status = 'ACTIVE' AND now() BETWEEN starts_at AND ends_at;
-- doit valoir 0
```

---

## 8. Seed

Le seed est **idempotent** et rejouable sans effet cumulatif. Il n'insère jamais de secret en dur.

### 8.1 Permissions et rôles — obligatoire dans tous les environnements

`permissions`, `roles` et `role_permissions` sont du référentiel, pas de la donnée : ils sont livrés avec le code et appliqués par `upsert` sur `code`.

| Fichier | Contenu |
|---|---|
| `01-permissions.seed.ts` | les ~30 codes de [`DATABASE_SCHEMA.md` §5.4](DATABASE_SCHEMA.md) |
| `02-roles.seed.ts` | `SUPER_ADMIN` (PLATFORM), `CLIENT_ADMIN` (ORGANIZATION), `SCANNER` (EVENT), `EVENT_ADMIN`, `REPORT_VIEWER`, `SESSION_MANAGER` — tous `is_system = true` |
| `03-role-permissions.seed.ts` | la matrice rôle × permission |

Un rôle `is_system = true` n'est **jamais** modifiable par une API. Toute évolution passe par une migration de seed, donc par une PR revue.

Une permission retirée du catalogue n'est pas supprimée en base : elle est retirée de `role_permissions`, ce qui la rend inopérante tout en préservant l'intégrité des `audit_logs` qui la référencent.

### 8.2 Bootstrap du premier `SUPER_ADMIN`

Problème d'amorçage : l'invariant INV-10 exige qu'un `SUPER_ADMIN` actif existe toujours, et INV-11 qu'il ait le MFA actif. Une base vierge ne satisfait ni l'un ni l'autre.

Procédure :

1. `04-bootstrap-super-admin.seed.ts` lit `BOOTSTRAP_SUPER_ADMIN_EMAIL` dans l'environnement ;
2. il crée l'utilisateur avec `status = PENDING` et **aucun mot de passe** ;
3. il génère un token de vérification à usage unique, affiché **une seule fois** sur la sortie standard ;
4. l'administrateur définit son mot de passe et enrôle son MFA via le flux normal ;
5. le passage à `ACTIVE` n'a lieu qu'après enrôlement MFA réussi.

**Aucun mot de passe n'est jamais écrit dans un seed**, y compris en développement. Un mot de passe de seed finit systématiquement en production.

### 8.3 Données de démonstration — développement uniquement

`05-demo-data.seed.ts` : deux organisations, quelques événements, sessions, participants et tickets. Refuse de s'exécuter si `NODE_ENV=production` — vérification en tête de fichier, pas en configuration.

---

## 9. Tests de migration

| Test | Ce qu'il prouve |
|---|---|
| **Aller simple** | `migrate reset` puis `migrate deploy` sur une base vierge aboutit |
| **Incrémental** | partir de l'avant-dernière migration, appliquer la dernière, aucune erreur |
| **Idempotence du seed** | exécuter `db:seed` deux fois produit le même état |
| **Dérive** | `prisma:migrate:diff --exit-code` retourne 0 |
| **Contraintes** | chaque `CHECK` rejette bien une valeur invalide — un `CHECK` non testé est un commentaire |
| **Invariants** | INV-01 à INV-12 ont chacun un test d'insertion qui **doit** échouer |
| **Index** | `EXPLAIN` confirme l'usage de l'index sur les requêtes de [`ENTITY_RELATIONSHIPS.md` §4](ENTITY_RELATIONSHIPS.md) |

Les tests d'intégration tournent contre le PostgreSQL réel de `docker-compose`, jamais contre SQLite ni un mock. Une base différente ne teste pas les mêmes contraintes.

---

## 10. Promotion entre environnements

| Environnement | Commande | Déclencheur |
|---|---|---|
| Local | `prisma migrate dev` | manuel |
| CI | `prisma migrate deploy` sur base éphémère | chaque PR |
| Développement | `prisma migrate deploy` | merge sur `develop` |
| Staging | `prisma migrate deploy` | création d'une branche `release/vX.Y.Z` |
| Production | `prisma migrate deploy` | merge sur `master` + tag, après validation en staging |

Voir [`GIT_STRATEGY.md` §9](../operations/GIT_STRATEGY.md) pour la correspondance branche ↔ environnement.

`migrate dev` n'est **jamais** exécuté hors du poste de développement : il peut réinitialiser la base.

`SHADOW_DATABASE_URL` est requis en développement et en CI pour la détection de dérive. C'est une base jetable, jamais la base applicative.

---

## 11. Séquence des 14 migrations

Reprise de [`DATABASE_SCHEMA.md` §12](DATABASE_SCHEMA.md), avec les dépendances explicites.

| # | Migration | Dépend de | Sprint |
|---:|---|---|---:|
| 1 | `identity_core` | — | 03 |
| 2 | `authorization_core` | 1 | 03 |
| 3 | `events_core` | 1, 2 | 03 |
| 8 | `audit_and_security` | 1, 3 | 03 |
| 4 | `invitations_and_verification` | 1, 2 | 04 |
| 5 | `sessions_and_rotations` | 1 | 04 |
| 6 | `passwords_and_mfa` | 1 | 04 |
| 13 | `idempotency` | 1 | 05 |
| 9 | `participants` | 1 | 10 |
| 10 | `registrations` | 3, 9 | 10 |
| 7 | `scanner_devices` | 1, 3 | 11 |
| 11 | `tickets` | 10 | 11 |
| 12 | `attendance` | 10, 11, 7 | 12 |
| 14 | `outbox` | 1 | 12 |

**Les numéros 1 à 8 conservent l'ordre du Document A §11** — la numérotation reflète l'ordre logique de dépendance, pas l'ordre chronologique d'application. La migration 8 (`audit_and_security`) est appliquée dès le sprint 03, avant les migrations 4 à 7 : l'audit doit exister **avant** la première écriture métier, sinon les premières opérations ne sont pas tracées et ce trou est définitif.
