# Eventini — Schéma de base de données

> **Statut :** Spécification normative · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Base :** PostgreSQL 18.4 · **ORM :** Prisma 7.9
> **Étend :** [`USER_MANAGEMENT_DATA_MODEL.md`](USER_MANAGEMENT_DATA_MODEL.md) (Document A) — conventions et 21 tables reprises telles quelles
> **Voir aussi :** [`ENTITY_RELATIONSHIPS.md`](ENTITY_RELATIONSHIPS.md) · [`MIGRATION_STRATEGY.md`](MIGRATION_STRATEGY.md)

> ⚠️ **Aucune de ces tables n'existe aujourd'hui.** Il n'y a **pas de `schema.prisma`** dans le dépôt — vérifié : `find . -name "*.prisma"` ne retourne rien. Il n'y a aucune migration, aucun seed, aucun `PrismaService`. Ce document décrit une **cible**, et il est la source de vérité pour l'écrire.

---

## 1. Portée

30 tables :

- **21 reprises du Document A** — noms, colonnes, enums et conventions d'index identiques. Six corrections y sont apportées, chacune signalée et justifiée en §8.
- **9 nouvelles** — référencées ailleurs dans le corpus mais jamais définies.

| Nouvelle table | Pourquoi elle manquait |
|---|---|
| `events` | Table fantôme : 3 clés étrangères pointent dessus, le Document A la crée en migration 3, mais elle n'a **aucune définition de colonne** nulle part (C-10) |
| `event_sessions` | Le module `event-sessions` existe dans toutes les arborescences ; zéro spécification |
| `participants` | Seules les permissions `participants.read` / `participants.import` existaient |
| `registrations` | Dossier de module uniquement |
| `registration_sessions` | Accès par session, exigé par le contexte produit §9.5 |
| `tickets` | Le Document B parle de « rotation des clés QR », le Document D redacte `qrPayload` — aucun modèle n'existait |
| `attendance_records` | Cœur métier du produit, jamais modélisé |
| `idempotency_records` | Exigée par le Document C §19.11, absente du plan du Document A (C-9) |
| `outbox_events` | Exigée par le contexte produit §12.6 « événement interne après commit » |

---

## 2. Conventions

### 2.1 Identifiants

**UUID v7** stocké en `TEXT`, généré côté application. UUID v7 plutôt que v4 : l'ordonnancement temporel préserve la localité d'insertion dans les index B-tree, ce qui compte sur `attendance_records` et `audit_logs`.

Préfixes lisibles obligatoires sur les identifiants exposés dans une API ou une URL :

```
usr_  org_  mbr_  ses_  rol_  perm_  evt_  esn_  par_  reg_
tkt_  att_  dev_  inv_  aud_  sec_  idm_  obx_
```

Jamais de `SERIAL` ni de `BIGSERIAL` sur une table exposée : un identifiant séquentiel est énumérable, ce qui facilite l'IDOR et fuite du volume d'activité.

### 2.2 Types

| Usage | Type PostgreSQL |
|---|---|
| Identifiant | `TEXT` |
| Horodatage | `TIMESTAMPTZ` — **jamais** `TIMESTAMP` |
| Enum | `TEXT` + `CHECK`, exposé en `enum` Prisma |
| Métadonnées libres | `JSONB` |
| Adresse IP | `INET` |
| Compteur de version | `INTEGER NOT NULL DEFAULT 1` |
| Booléen | `BOOLEAN NOT NULL DEFAULT` explicite |

`TEXT` + `CHECK` plutôt que `CREATE TYPE ... AS ENUM` : ajouter une valeur à un enum PostgreSQL natif est possible mais en retirer une exige une réécriture de table. Le `CHECK` se modifie par une migration ordinaire.

### 2.3 Colonnes transverses

| Colonne | Sens |
|---|---|
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` |
| `created_by` | FK `users(id)`, `NULL` si l'origine est le système |
| `updated_at` | mis à jour à chaque écriture |
| `updated_by` | FK `users(id)` |
| `deleted_at` / `deleted_by` / `deletion_reason` | soft delete uniquement |
| `version` | verrou optimiste, incrémenté à chaque écriture |

Elles ne sont **pas** appliquées mécaniquement partout. §2.5 décide table par table, et chaque fiche de table justifie ses absences.

### 2.4 Propriété tenant — 4 catégories

| Catégorie | Sens | Filtre obligatoire |
|---|---|---|
| `PLATFORM` | Donnée globale, hors tenant | aucun |
| `GLOBAL-REFERENCE` | Référentiel partagé, lecture seule à l'exécution (`roles`, `permissions`) | aucun |
| `ORGANIZATION-OWNED` | `organization_id NOT NULL` en colonne directe | `organization_id` |
| `EVENT-OWNED` | `event_id NOT NULL` **et** `organization_id NOT NULL` dénormalisé | `organization_id` |

**`organization_id` est dénormalisé sur toutes les tables `EVENT-OWNED`.** Ce n'est pas une optimisation : c'est ce qui permet à l'extension Prisma de [ADR-0003](../adr/0003-tenant-isolation-strategy.md) de vérifier le scope tenant **sans jointure**. Sans cette colonne, la garde ne peut pas être universelle, et l'isolation redevient déclarative. La cohérence est maintenue par les invariants de §6.

### 2.5 Politique de suppression — 3 régimes

| Régime | Tables | Règle |
|---|---|---|
| `SOFT_DELETE` | `users`, `organizations`, `organization_memberships`, `events`, `participants`, `scanner_devices` | `deleted_at` renseigné, ligne conservée, exclue de toute lecture par défaut |
| `REVOKE_NOT_DELETE` | `membership_role_assignments`, `platform_role_assignments`, `event_user_assignments`, `user_sessions`, `refresh_token_rotations`, `scanner_device_assignments`, `user_invitations`, `tickets`, `mfa_methods` | jamais supprimée ; `revoked_at` + `status` |
| `APPEND_ONLY` | `security_events`, `audit_logs`, `attendance_records`, `outbox_events` | aucune mise à jour, aucune suppression applicative ; purge par rétention uniquement |

`attendance_records` est **append-only** : un check-in erroné n'est pas corrigé par un `UPDATE`, il est compensé par un nouvel enregistrement de type correctif. C'est ce qui rend la présence auditable.

Tout index unique sur une table `SOFT_DELETE` est **partiel** : `WHERE deleted_at IS NULL`. Sans cela, un enregistrement supprimé bloquerait la réutilisation de sa valeur unique pour toujours.

### 2.6 Nommage des index

| Préfixe | Sens |
|---|---|
| `ux_` | unique |
| `ix_` | non unique |
| `ck_` | contrainte CHECK |
| `fk_` | clé étrangère nommée |

Les index tenant commencent par `organization_id` (Document A §8.1) : c'est la colonne présente dans **toutes** les requêtes tenant-scopées, donc celle qui doit être en tête pour que l'index soit utilisable.

---

## 3. Inventaire

| # | Table | Propriété | Suppression | Migration |
|---:|---|---|---|---:|
| 1 | `users` | `PLATFORM` | `SOFT_DELETE` | 1 |
| 2 | `user_credentials` | `PLATFORM` | cascade utilisateur | 1 |
| 3 | `organizations` | `PLATFORM` | `SOFT_DELETE` | 1 |
| 4 | `organization_memberships` | `ORGANIZATION-OWNED` | `SOFT_DELETE` | 1 |
| 5 | `roles` | `GLOBAL-REFERENCE` | jamais | 2 |
| 6 | `permissions` | `GLOBAL-REFERENCE` | jamais | 2 |
| 7 | `role_permissions` | `GLOBAL-REFERENCE` | remplacement | 2 |
| 8 | `membership_role_assignments` | `ORGANIZATION-OWNED` | `REVOKE_NOT_DELETE` | 2 |
| 9 | `platform_role_assignments` | `PLATFORM` | `REVOKE_NOT_DELETE` | 2 |
| 10 | `events` | `ORGANIZATION-OWNED` | `SOFT_DELETE` | 3 |
| 11 | `event_sessions` | `EVENT-OWNED` | `SOFT_DELETE` | 3 |
| 12 | `event_user_assignments` | `EVENT-OWNED` | `REVOKE_NOT_DELETE` | 3 |
| 13 | `user_invitations` | `ORGANIZATION-OWNED` | `REVOKE_NOT_DELETE` | 4 |
| 14 | `email_verification_tokens` | `PLATFORM` | `REVOKE_NOT_DELETE` | 4 |
| 15 | `user_sessions` | mixte — voir fiche | `REVOKE_NOT_DELETE` | 5 |
| 16 | `refresh_token_rotations` | suit la session | `APPEND_ONLY` | 5 |
| 17 | `password_reset_tokens` | `PLATFORM` | `REVOKE_NOT_DELETE` | 6 |
| 18 | `mfa_methods` | `PLATFORM` | `REVOKE_NOT_DELETE` | 6 |
| 19 | `mfa_recovery_codes` | `PLATFORM` | consommation | 6 |
| 20 | `scanner_devices` | `ORGANIZATION-OWNED` | `SOFT_DELETE` | 7 |
| 21 | `scanner_device_assignments` | `EVENT-OWNED` | `REVOKE_NOT_DELETE` | 7 |
| 22 | `security_events` | mixte | `APPEND_ONLY` | 8 |
| 23 | `audit_logs` | mixte | `APPEND_ONLY` | 8 |
| 24 | `participants` | `ORGANIZATION-OWNED` | `SOFT_DELETE` | 9 |
| 25 | `registrations` | `EVENT-OWNED` | `REVOKE_NOT_DELETE` | 10 |
| 26 | `registration_sessions` | `EVENT-OWNED` | `REVOKE_NOT_DELETE` | 10 |
| 27 | `tickets` | `EVENT-OWNED` | `REVOKE_NOT_DELETE` | 11 |
| 28 | `attendance_records` | `EVENT-OWNED` | `APPEND_ONLY` | 12 |
| 29 | `idempotency_records` | `ORGANIZATION-OWNED` nullable | purge TTL | 13 |
| 30 | `outbox_events` | `ORGANIZATION-OWNED` nullable | `APPEND_ONLY` + purge | 14 |

---

## 4. Domaine identité

### 4.1 `users`

**Rôle** — identité globale de la plateforme. **Propriété** `PLATFORM`. **Suppression** `SOFT_DELETE`.

Un utilisateur n'appartient à **aucune** organisation. Cette table ne contient jamais `organization_id`, `role` ni `permissions` : l'appartenance passe exclusivement par `organization_memberships`. C'est ce qui rend le multi-appartenance possible.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `usr_` |
| `primary_email` | TEXT | non | tel que saisi |
| `normalized_email` | TEXT | non | minuscules, trim, NFKC — sert à l'unicité et au rate limiting |
| `first_name` | TEXT | non | |
| `last_name` | TEXT | non | |
| `display_name` | TEXT | oui | |
| `status` | TEXT | non | `PENDING` `ACTIVE` `LOCKED` `SUSPENDED` `DEACTIVATED` `DELETED` |
| `email_verified_at` | TIMESTAMPTZ | oui | |
| `last_login_at` | TIMESTAMPTZ | oui | |
| `locale` | TEXT | oui | BCP 47 |
| `timezone` | TEXT | oui | IANA |
| `version` | INTEGER | non | incrémenté sur tout changement sensible ; comparé au claim `ver` |
| `created_at` `created_by` `updated_at` `updated_by` `deleted_at` `deleted_by` `deletion_reason` | | | transverses |

**Index** — `ux_users_normalized_email_active(normalized_email) WHERE deleted_at IS NULL` · `ix_users_status(status)` · `ix_users_created_at(created_at DESC)` · `ix_users_last_login_at(last_login_at DESC) WHERE last_login_at IS NOT NULL`

**Contraintes** — `status` n'est **jamais** modifiable par une entrée frontend. `version` est incrémenté à tout changement d'email, de statut ou de mot de passe : cela invalide immédiatement les access tokens en circulation (étape 3 de la chaîne d'autorisation, [ADR-0004](../adr/0004-permission-resolution-and-caching.md)).

**Audit** — toutes les colonnes transverses. `version` présent car c'est le pivot de l'invalidation de token.

---

### 4.2 `user_credentials`

**Rôle** — secret d'authentification, séparé de l'identité. **Propriété** `PLATFORM`. **Suppression** cascade avec l'utilisateur.

Table séparée pour une raison précise : une lecture de profil ne doit **jamais** ramener le hash. La séparation rend l'erreur structurellement impossible plutôt que dépendante d'un `select`.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | |
| `user_id` | TEXT FK `users` | non | |
| `password_hash` | TEXT | non | Argon2id encodé — voir [ADR-0007](../adr/0007-password-hashing-argon2id.md) |
| `password_changed_at` | TIMESTAMPTZ | non | |
| `password_version` | INTEGER | non | profil de paramètres Argon2id ; `1` = m=19456 t=2 p=1 |
| `must_change_password` | BOOLEAN | non | défaut `false` |
| `created_at` `updated_at` | | | |

**Index** — `ux_user_credentials_user_id(user_id)` — relation 1:1 stricte.

**Contraintes** — un changement de `password_version` inférieur au profil courant déclenche un rehash transparent à la vérification suivante. `password_hash` ne sort jamais de la couche infrastructure, ni en réponse, ni en log (redacté par le Document D §30).

**Audit** — pas de `created_by` / `updated_by` : l'acteur est toujours l'utilisateur lui-même ou un reset tracé dans `security_events`. Pas de soft delete : la ligne suit l'utilisateur.

---

### 4.3 `user_sessions`

**Rôle** — registre serveur des sessions. **Propriété** mixte : `PLATFORM` si `organization_id IS NULL`, sinon `ORGANIZATION-OWNED`. **Suppression** `REVOKE_NOT_DELETE`.

C'est la table qui rend AUTH-INV-004 possible : un JWT valide ne suffit pas, la session doit exister et être active.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `ses_` — c'est le claim `sid` |
| `user_id` | TEXT FK `users` | non | |
| `organization_id` | TEXT FK `organizations` | **oui** | `NULL` **uniquement** pour une session plateforme |
| `active_membership_id` | TEXT FK `organization_memberships` | **oui** | idem |
| `token_family_id` | TEXT | non | racine de la chaîne de rotation |
| `client_type` | TEXT | non | `WEB` `MOBILE_SCANNER` |
| `status` | TEXT | non | `ACTIVE` `REVOKED` `EXPIRED` `COMPROMISED` `REPLACED` |
| `device_id` | TEXT FK `scanner_devices` | oui | |
| `device_name` | TEXT | oui | |
| `user_agent` | TEXT | oui | normalisé, jamais brut |
| `ip_address` | INET | oui | tronqué selon la politique PII (Document D §31) |
| `authentication_level` | TEXT | non | `PASSWORD` `MFA` `REAUTHENTICATED` |
| `mfa_verified_at` | TIMESTAMPTZ | oui | |
| `created_at` | TIMESTAMPTZ | non | |
| `last_seen_at` | TIMESTAMPTZ | non | |
| `idle_expires_at` | TIMESTAMPTZ | non | repoussé à chaque rotation |
| `absolute_expires_at` | TIMESTAMPTZ | non | **jamais** prolongé |
| `revoked_at` `revoked_by` `revocation_reason` | | oui | |
| `created_by_request_id` | TEXT | oui | corrélation avec les logs |
| `updated_at` | | non | |

**Index** — `ix_sessions_user_status(user_id, status)` · `ix_sessions_membership_status(active_membership_id, status)` · `ix_sessions_org_status(organization_id, status)` · `ix_sessions_family(token_family_id)` · `ix_sessions_idle_expiry(idle_expires_at) WHERE status='ACTIVE'` · `ix_sessions_absolute_expiry(absolute_expires_at) WHERE status='ACTIVE'` · `ix_sessions_device_status(device_id, status) WHERE device_id IS NOT NULL`

**Contraintes**

```sql
CONSTRAINT ck_sessions_tenant_coherence CHECK (
  (organization_id IS NULL     AND active_membership_id IS NULL) OR
  (organization_id IS NOT NULL AND active_membership_id IS NOT NULL)
)
CONSTRAINT ck_sessions_expiry_order CHECK (idle_expires_at <= absolute_expires_at)
```

Le premier CHECK résout C-29 : le Document A rendait les deux colonnes nullables tout en affirmant qu'elles « doivent être cohérentes », sans jamais définir le cas plateforme.

**Pas de colonne `current_refresh_token_hash`** — voir [ADR-0014](../adr/0014-refresh-token-hash-single-store.md), qui résout C-1.

**Audit** — pas de soft delete, pas de `version` : une session est révoquée, jamais supprimée ni modifiée concurremment.

---

### 4.4 `refresh_token_rotations`

**Rôle** — chaîne de rotation et détection de rejeu. **Propriété** suit la session. **Suppression** `APPEND_ONLY`.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | |
| `session_id` | TEXT FK `user_sessions` | non | |
| `token_family_id` | TEXT | non | dupliqué pour révoquer une famille sans jointure |
| `token_hash` | TEXT | non | **HMAC-SHA-256** d'un token opaque de 32 octets |
| `previous_token_id` | TEXT FK self | oui | |
| `replaced_by_token_id` | TEXT FK self | oui | |
| `status` | TEXT | non | `ACTIVE` `CONSUMED` `REVOKED` `EXPIRED` `REUSED` |
| `issued_at` `expires_at` | TIMESTAMPTZ | non | |
| `consumed_at` `revoked_at` `reuse_detected_at` | TIMESTAMPTZ | oui | |
| `created_at` | | non | |

**Index** — `ux_refresh_token_hash(token_hash)` · **`ux_refresh_active_per_family(token_family_id) WHERE status='ACTIVE'`** · `ix_refresh_session_status(session_id, status)` · `ix_refresh_family_status(token_family_id, status)` · `ix_refresh_expires(expires_at) WHERE status='ACTIVE'` · `ix_refresh_previous(previous_token_id) WHERE previous_token_id IS NOT NULL`

`ux_refresh_active_per_family` est **ajouté** : le Document A affirmait l'invariant sans l'indexer (C-27). C'est lui qui rend deux rotations concurrentes mutuellement exclusives sans verrou applicatif.

**Contraintes** — présenter un token dont la ligne est `CONSUMED`, `REVOKED` ou `EXPIRED` déclenche la procédure de rejeu : session `COMPROMISED`, famille entière révoquée, aucun token émis, security event `REFRESH_TOKEN_REUSE_DETECTED`.

**Audit** — aucune colonne transverse hors `created_at` : la table **est** la piste d'audit.

---

### 4.5 `password_reset_tokens`

**Propriété** `PLATFORM`. **Suppression** `REVOKE_NOT_DELETE`.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | |
| `user_id` | TEXT FK `users` | non | |
| `token_hash` | TEXT | non | SHA-256, jamais le token en clair |
| `status` | TEXT | non | `PENDING` `USED` `EXPIRED` `REVOKED` `REPLACED` |
| `expires_at` | TIMESTAMPTZ | non | **+30 min** ([ADR-0009](../adr/0009-token-and-session-lifetimes.md)) |
| `used_at` `revoked_at` | TIMESTAMPTZ | oui | |
| `requested_ip` | INET | oui | |
| `created_at` | | non | |

**Index** — `ux_password_reset_token_hash(token_hash)` · `ix_password_reset_user_status(user_id, status)` · `ix_password_reset_expires(expires_at) WHERE status='PENDING'`

**Contraintes** — toute nouvelle demande passe les tokens `PENDING` du même utilisateur en `REPLACED`. Usage unique. La réponse HTTP est **identique** que le compte existe ou non (protection contre l'énumération).

---

### 4.6 `email_verification_tokens`

**Propriété** `PLATFORM`. **Suppression** `REVOKE_NOT_DELETE`.

Colonnes : `id`, `user_id` FK, `email`, `normalized_email`, `token_hash`, `status` (`PENDING` `VERIFIED` `EXPIRED` `REVOKED` `REPLACED` — le Document A ne les énumérait pas), `expires_at` (**+24 h**), `verified_at`, `revoked_at`, `created_at`.

**Index** — `ux_email_verification_token_hash(token_hash)` · `ix_email_verification_user_status(user_id, status)` · `ix_email_verification_email_status(normalized_email, status)`

---

### 4.7 `mfa_methods`

**Propriété** `PLATFORM`. **Suppression** `REVOKE_NOT_DELETE`.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | |
| `user_id` | TEXT FK `users` | non | |
| `type` | TEXT | non | `TOTP` uniquement au MVP |
| `status` | TEXT | non | `PENDING` `ACTIVE` `DISABLED` `COMPROMISED` |
| `encrypted_secret` | TEXT | non | **chiffré**, pas haché — il doit être relu pour vérifier un code |
| `verified_at` `enabled_at` `disabled_at` | TIMESTAMPTZ | oui | |
| `created_at` `updated_at` | | non | |

**Index** — `ux_mfa_user_type_pending(user_id, type) WHERE status='PENDING'` · **`ux_mfa_user_type_active(user_id, type) WHERE status='ACTIVE'`** · `ix_mfa_user_status(user_id, status)`

L'index unique combiné du Document A (`WHERE status IN ('PENDING','ACTIVE')`) **empêchait tout ré-enrôlement** tant qu'une méthode active existait, alors que le Document B exige de supporter l'enrôlement et la désactivation (C-28). La séparation en deux index partiels autorise un `PENDING` à coexister avec un `ACTIVE`, ce qui est exactement le déroulé d'un remplacement d'appareil.

**Contraintes** — le secret est chiffré avec la clé dédiée « chiffrement MFA » (Document B §40.2), n'est **jamais** retourné après confirmation, n'est jamais journalisé. Paramètres TOTP retenus, absents du corpus : **SHA-1, 6 chiffres, période 30 s, fenêtre de dérive ±1**.

---

### 4.8 `mfa_recovery_codes`

**Propriété** `PLATFORM`. Colonnes : `id`, `mfa_method_id` FK, `code_hash`, `used_at`, `revoked_at`, `created_at`.

**Index** — `ux_mfa_recovery_code_hash(code_hash)` · `ix_mfa_recovery_method_available(mfa_method_id, used_at, revoked_at)`

**Paramètres retenus**, absents du corpus : **10 codes**, **10 caractères** en alphabet Crockford base32 (sans `I`, `L`, `O`, `U`), hachés en SHA-256, affichés **une seule fois**, régénérés par lot atomique — l'ancien lot entier est révoqué dans la même transaction.

---

## 5. Domaine organisations et autorisation

### 5.1 `organizations`

**Rôle** — le tenant. **Propriété** `PLATFORM`. **Suppression** `SOFT_DELETE`.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `org_` |
| `name` | TEXT | non | |
| `slug` | TEXT | non | |
| `status` | TEXT | non | `ACTIVE` `SUSPENDED` `KILLED` `DELETED` |
| `license_plan` | TEXT | non | |
| `user_limit` `event_limit` | INTEGER | oui | `NULL` = illimité |
| `is_enabled` | BOOLEAN | non | kill-switch immédiat, indépendant de `status` |
| `version` | INTEGER | non | |
| transverses + soft delete | | | |

**Index** — `ux_organizations_slug_active(slug) WHERE deleted_at IS NULL` · `ix_organizations_status(status)` · `ix_organizations_is_enabled(is_enabled)`

**Contraintes** — `status` et `is_enabled` sont **tous deux** vérifiés à l'étape 4 de la chaîne d'autorisation. `is_enabled = false` coupe l'accès sans transition d'état, ce qui permet un kill-switch réversible en une écriture ; `KILLED` est la transition d'état durable. Le contexte produit §8.1 avertit qu'un booléen ne doit pas remplacer un état métier : ici les deux coexistent avec des rôles distincts, ce qui est explicite et voulu.

---

### 5.2 `organization_memberships`

**Rôle** — lien utilisateur ↔ organisation, pivot du multi-tenant. **Propriété** `ORGANIZATION-OWNED`. **Suppression** `SOFT_DELETE`.

Colonnes : `id`, `user_id` FK, `organization_id` FK, `status` (`INVITED` `ACTIVE` `SUSPENDED` `REVOKED` `EXPIRED` `DELETED`), `joined_at`, `invited_by`, `activated_at`, `activated_by`, `suspended_at`, `suspended_by`, `suspension_reason`, `revoked_at`, `revoked_by`, `revocation_reason`, `version`, transverses, soft delete.

**Index** — `ux_membership_user_org_active(user_id, organization_id) WHERE deleted_at IS NULL` · `ix_memberships_org_status(organization_id, status)` · `ix_memberships_user_status(user_id, status)` · `ix_memberships_org_created(organization_id, created_at DESC)`

**Contraintes** — un utilisateur a **au plus un** membership non supprimé par organisation. Toute transition de statut incrémente `permissionsVersion` (invalidation du cache, [ADR-0004](../adr/0004-permission-resolution-and-caching.md)) et révoque les sessions dont `active_membership_id` pointe ici.

---

### 5.3 `roles` · 5.4 `permissions` · 5.5 `role_permissions`

**Propriété** `GLOBAL-REFERENCE` — référentiel partagé, alimenté par seed, jamais écrit à l'exécution.

`roles` : `id`, `code`, `name`, `scope` (`PLATFORM` `ORGANIZATION` `EVENT`), `description`, `is_system`, `created_at`, `updated_at`.
Index : `ux_roles_code(code)` · `ix_roles_scope(scope)` · `ix_roles_system(is_system)`.

Portées fixées : `SUPER_ADMIN → PLATFORM`, `CLIENT_ADMIN → ORGANIZATION`, **`SCANNER → EVENT`** ([ADR-0015](../adr/0015-scanner-role-scope.md), résout C-17).

`permissions` : `id`, `code`, `resource`, `action`, `description`, `created_at`, `updated_at`.
Index : `ux_permissions_code(code)` · `ix_permissions_resource_action(resource, action)`.

Convention `resource.action`, minuscules, `snake_case` pour les actions composées. Catalogue initial — 17 codes du Document B §32, plus ceux exigés par les nouveaux domaines :

```
organizations.read      events.read        participants.read      attendance.check_in
organizations.manage    events.create      participants.import    attendance.check_out
users.read              events.update      participants.export    attendance.override
users.invite            events.activate    registrations.read     reports.read
users.manage_roles      events.cancel      registrations.manage   reports.export
sessions.read           event_sessions.manage
sessions.revoke         tickets.issue      scanners.manage
                        tickets.revoke     scanners.assign
platform.organizations.manage   platform.kill_switch.execute   platform.users.impersonate
```

`role_permissions` : PK composite `(role_id, permission_id)`, `created_at`, `created_by`.
Index : `ix_role_permissions_permission(permission_id, role_id)` — sens inverse, pour répondre à « quels rôles portent cette permission ».

---

### 5.6 `membership_role_assignments`

**Propriété** `ORGANIZATION-OWNED` (via le membership). **Suppression** `REVOKE_NOT_DELETE`.

> ✅ **Résolu par [EVT-021](../sprints/sprint-04/README.md#evt-021)** — la colonne `organization_id` est ajoutée par la migration 4, avec son trigger de cohérence `trg_membership_role_tenant`. La table est désormais gardée sur la colonne comme toutes les autres, et le contournement par relation d'EVT-018 est **supprimé**. Le reste de cette note documente le problème d'origine.
>
> 🔴 **Contradiction avec le §2.4 et [ADR-0003](../adr/0003-tenant-isolation-strategy.md) §1, relevée par [EVT-018](../sprints/sprint-03/README.md#evt-018).** Le §2.4 définit `ORGANIZATION-OWNED` comme « `organization_id NOT NULL` en colonne directe » et l'ADR-0003 §1 ajoute qu'« **aucune** table métier ne dépend d'une jointure transitive pour connaître son tenant ». Cette fiche est la **seule** des 30 à revendiquer la catégorie « via » une autre table, et sa liste de colonnes ne contient effectivement pas `organization_id` — c'est donc ce qu'EVT-014 a construit.
>
> En attendant le correctif, la garde tenant traverse la relation `membership` pour cette table plutôt que de l'exempter : c'est ici que vivent les attributions de rôle, et une écriture non scopée y est une escalade de privilège inter-tenant. **Correctif attendu : ajouter `organization_id NOT NULL` dénormalisé dans la vague de migrations d'[EVT-021](../sprints/sprint-04/README.md#evt-021)**, avec le trigger de cohérence correspondant, sur le modèle d'INV-01.

Colonnes : `id`, `membership_id` FK, `role_id` FK, `assigned_at`, `assigned_by`, `revoked_at`, `revoked_by`, `revocation_reason`, `created_at`.

**Index** — `ux_membership_role_active(membership_id, role_id) WHERE revoked_at IS NULL` · `ix_membership_roles_membership(membership_id, revoked_at)` · `ix_membership_roles_role(role_id, revoked_at)`

**Contraintes** — un rôle de portée `PLATFORM` ne peut **jamais** être assigné ici. Vérifié applicativement **et** par un trigger : c'est la voie la plus directe d'une escalade de privilège, elle ne doit pas dépendre du seul code applicatif.

---

### 5.7 `platform_role_assignments`

**Propriété** `PLATFORM`. **Suppression** `REVOKE_NOT_DELETE`.

Colonnes : `id`, `user_id` FK, `role_id` FK, `status` (`ACTIVE` `SUSPENDED` `REVOKED` — non énumérés dans le Document A), `assigned_at`, `assigned_by`, `revoked_at`, `revoked_by`, `revocation_reason`, `created_at`, `updated_at`.

**Index** — `ux_platform_role_user_active(user_id, role_id) WHERE revoked_at IS NULL` · `ix_platform_roles_user_status(user_id, status)` · `ix_platform_roles_role_status(role_id, status)`

**Contraintes** — MFA **obligatoire** pour tout `SUPER_ADMIN` : l'assignation est refusée si `mfa_methods` ne contient aucune méthode `ACTIVE` pour cet utilisateur. **Révoquer le dernier `SUPER_ADMIN` actif est interdit** — contrainte vérifiée par trigger, avec l'alerte « Aucun SUPER_ADMIN actif » du Document D §35 en filet.

---

### 5.8 `user_invitations`

**Propriété** `ORGANIZATION-OWNED`. **Suppression** `REVOKE_NOT_DELETE`.

Colonnes : `id`, `organization_id` FK, `email`, `normalized_email`, `invited_user_id` FK nullable, `membership_id` FK nullable, `role_id` FK, `token_hash`, `status` (`PENDING` `ACCEPTED` `EXPIRED` `REVOKED` `REPLACED`), `expires_at` (**+7 j**), `accepted_at`, `created_by`, `created_at`, `updated_at`, `revoked_at`, `revoked_by`.

**Index** — `ux_invitation_token_hash(token_hash)` · `ix_invitations_org_status(organization_id, status)` · `ix_invitations_email_status(normalized_email, status)` · `ix_invitations_expires(expires_at) WHERE status='PENDING'`

---

## 6. Domaine événementiel

### 6.1 `events` — **nouvelle table**

**Rôle** — un événement. **Propriété** `ORGANIZATION-OWNED`. **Suppression** `SOFT_DELETE`.

Table **fantôme** dans le corpus : le Document A la crée en migration 3 et trois clés étrangères pointent dessus, mais elle n'a aucune définition de colonne, aucun enum de statut, aucun index (C-10).

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `evt_` |
| `organization_id` | TEXT FK `organizations` | non | |
| `name` | TEXT | non | |
| `slug` | TEXT | non | unique **par organisation** |
| `description` | TEXT | oui | |
| `status` | TEXT | non | `DRAFT` `ACTIVE` `EXPIRED` `CANCELLED` (contexte produit §8.2) |
| `event_code` | TEXT | non | code court d'activation scanner, non prédictible |
| `timezone` | TEXT | non | IANA — indispensable au calcul des fenêtres de check-in |
| `starts_at` `ends_at` | TIMESTAMPTZ | non | |
| `check_in_opens_at` `check_in_closes_at` | TIMESTAMPTZ | oui | `NULL` = suit `starts_at` / `ends_at` |
| `capacity` | INTEGER | oui | `NULL` = illimité |
| `location_name` | TEXT | oui | |
| `settings` | JSONB | non | défaut `'{}'` — réglages métier non structurants |
| `activated_at` `activated_by` | | oui | |
| `cancelled_at` `cancelled_by` `cancellation_reason` | | oui | |
| `expired_at` | TIMESTAMPTZ | oui | |
| `version` | INTEGER | non | verrou optimiste, exposé en ETag |
| transverses + soft delete | | | |

**Index** — `ux_events_org_slug_active(organization_id, slug) WHERE deleted_at IS NULL` · `ux_events_event_code_active(event_code) WHERE deleted_at IS NULL` · `ix_events_org_status(organization_id, status)` · `ix_events_org_starts_at(organization_id, starts_at DESC)` · `ix_events_status_check_in(status, check_in_opens_at, check_in_closes_at)`

**Contraintes**

```sql
CONSTRAINT ck_events_date_order CHECK (starts_at < ends_at)
CONSTRAINT ck_events_checkin_window CHECK (
  check_in_opens_at IS NULL OR check_in_closes_at IS NULL
  OR check_in_opens_at < check_in_closes_at
)
```

Transitions autorisées : `DRAFT → ACTIVE → EXPIRED`, et `DRAFT|ACTIVE → CANCELLED`. **Aucun retour** depuis `EXPIRED` ou `CANCELLED`. `DRAFT → ACTIVE` exige au moins une `event_sessions`.

`event_code` est unique globalement (pas par organisation) car un scanner le saisit **avant** que le tenant soit connu. Il doit donc être non prédictible : 8 caractères Crockford base32, jamais séquentiel.

**Audit** — toutes les transverses ; `version` car l'événement est éditable de façon concurrente par plusieurs administrateurs.

---

### 6.2 `event_sessions` — **nouvelle table**

**Rôle** — subdivision d'un événement : journée, panel, atelier, zone, créneau. **Propriété** `EVENT-OWNED`. **Suppression** `SOFT_DELETE`.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `esn_` |
| `organization_id` | TEXT FK | non | **dénormalisé** — voir §2.4 |
| `event_id` | TEXT FK `events` | non | |
| `name` | TEXT | non | |
| `session_type` | TEXT | non | `DAY` `PANEL` `WORKSHOP` `ZONE` `SLOT` |
| `status` | TEXT | non | `SCHEDULED` `OPEN` `CLOSED` (contexte produit §8.3) |
| `starts_at` `ends_at` | TIMESTAMPTZ | non | |
| `check_in_opens_at` `check_in_closes_at` | TIMESTAMPTZ | oui | |
| `capacity` | INTEGER | oui | |
| `location_name` | TEXT | oui | |
| `requires_separate_check_in` | BOOLEAN | non | défaut `true` |
| `opened_at` `opened_by` `closed_at` `closed_by` | | oui | |
| `version` | INTEGER | non | |
| transverses + soft delete | | | |

**Index** — `ix_event_sessions_org_event(organization_id, event_id)` · `ix_event_sessions_event_status(event_id, status)` · `ix_event_sessions_event_starts(event_id, starts_at)` · `ix_event_sessions_open_window(status, check_in_opens_at, check_in_closes_at) WHERE status='OPEN'`

**Contraintes** — `ck_event_sessions_date_order CHECK (starts_at < ends_at)`. `organization_id` **doit** égaler `events.organization_id` (invariant §8, trigger). Un check-in n'est accepté que si la session est `OPEN` **et** dans sa fenêtre — les deux, pas l'une ou l'autre.

---

### 6.3 `event_user_assignments`

**Propriété** `EVENT-OWNED`. **Suppression** `REVOKE_NOT_DELETE`.

Colonnes : `id`, `organization_id` FK, `event_id` FK, `membership_id` FK, `assignment_type` (`EVENT_ADMIN` `SCANNER` `REPORT_VIEWER` `SESSION_MANAGER`), `status`, `valid_from`, `valid_until`, `assigned_at`, `assigned_by`, `revoked_at`, `revoked_by`, `created_at`, `updated_at`.

**Index** — `ux_event_assignment_active(event_id, membership_id, assignment_type) WHERE revoked_at IS NULL` · `ix_event_assignments_membership(membership_id, status)` · `ix_event_assignments_event(event_id, status)` · `ix_event_assignments_org_event(organization_id, event_id)`

**Contraintes** — `organization_id` égale à la fois `events.organization_id` et `organization_memberships.organization_id`. Une assignation hors de sa fenêtre `valid_from` / `valid_until` n'accorde **aucun** droit, même non révoquée.

---

## 7. Domaine participants, tickets et présence

### 7.1 `participants` — **nouvelle table**

**Rôle** — personne physique attendue. **Propriété** `ORGANIZATION-OWNED`. **Suppression** `SOFT_DELETE`.

Un participant appartient à l'**organisation**, pas à l'événement : il peut être inscrit à plusieurs événements sans duplication. C'est aussi ce qui rend la déduplication possible.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `par_` |
| `organization_id` | TEXT FK | non | |
| `email` | TEXT | oui | un participant peut n'avoir aucun email |
| `normalized_email` | TEXT | oui | clé de déduplication |
| `first_name` `last_name` | TEXT | non | |
| `phone` | TEXT | oui | E.164 |
| `participant_type` | TEXT | non | `STANDARD` `TRAVEL_GRANT` `AMBASSADOR` `SPEAKER` `STAFF` `VIP` |
| `organization_name` `job_title` | TEXT | oui | employeur du participant, sans lien avec le tenant |
| `country` | TEXT | oui | ISO 3166-1 alpha-2 |
| `external_reference` | TEXT | oui | identifiant du système source à l'import |
| `metadata` | JSONB | non | défaut `'{}'` — champs personnalisés |
| `dedup_fingerprint` | TEXT | non | hash normalisé nom+email+téléphone |
| `version` | INTEGER | non | |
| transverses + soft delete | | | |

**Index** — `ux_participants_org_email_active(organization_id, normalized_email) WHERE normalized_email IS NOT NULL AND deleted_at IS NULL` · `ix_participants_org_dedup(organization_id, dedup_fingerprint)` · `ix_participants_org_type(organization_id, participant_type)` · `ix_participants_org_created(organization_id, created_at DESC)` · `ix_participants_org_lastname(organization_id, last_name)`

**Contraintes** — unicité de l'email **par organisation**, jamais globale : la même personne peut être participante chez deux clients, ce sont deux enregistrements sans lien. C'est une exigence d'isolation, pas une limitation.

**PII** — données minimisées (Document D §31). Les exports sont soumis à `participants.export` et audités. La politique de rétention est portée par l'organisation.

---

### 7.2 `registrations` — **nouvelle table**

**Rôle** — inscription d'un participant à un événement. **Propriété** `EVENT-OWNED`. **Suppression** `REVOKE_NOT_DELETE`.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `reg_` |
| `organization_id` `event_id` `participant_id` | TEXT FK | non | |
| `status` | TEXT | non | `PENDING` `CONFIRMED` `WAITLISTED` `CANCELLED` `REJECTED` |
| `source` | TEXT | non | `MANUAL` `IMPORT` `SELF_SERVICE` `INVITATION` `API` |
| `registration_code` | TEXT | non | référence humainement lisible, unique par événement |
| `registered_at` | TIMESTAMPTZ | non | |
| `confirmed_at` `confirmed_by` | | oui | |
| `cancelled_at` `cancelled_by` `cancellation_reason` | | oui | |
| `import_batch_id` | TEXT | oui | traçabilité de l'import d'origine |
| `metadata` | JSONB | non | défaut `'{}'` |
| `version` | INTEGER | non | |
| transverses | | | |

**Index** — `ux_registrations_event_participant(event_id, participant_id) WHERE status <> 'CANCELLED'` · `ux_registrations_event_code(event_id, registration_code)` · `ix_registrations_org_event_status(organization_id, event_id, status)` · `ix_registrations_participant(participant_id, status)` · `ix_registrations_event_created(event_id, created_at DESC)`

**Contraintes** — un participant a **au plus une** inscription non annulée par événement : c'est l'index unique partiel qui l'impose, pas le code. Réinscription après annulation autorisée.

---

### 7.3 `registration_sessions` — **nouvelle table**

**Rôle** — droit d'accès d'une inscription à une session d'événement. **Propriété** `EVENT-OWNED`.

Colonnes : `id`, `organization_id` FK, `event_id` FK, `registration_id` FK, `event_session_id` FK, `status` (`GRANTED` `REVOKED` `WAITLISTED`), `granted_at`, `granted_by`, `revoked_at`, `revoked_by`, `created_at`, `updated_at`.

**Index** — `ux_registration_session(registration_id, event_session_id) WHERE status='GRANTED'` · `ix_registration_sessions_session(event_session_id, status)` · `ix_registration_sessions_org_event(organization_id, event_id)`

**Contraintes** — c'est la table interrogée à l'étape « le porteur a-t-il le droit d'entrer dans **cette** session ». Absence de ligne `GRANTED` ⇒ refus, sans exception.

---

### 7.4 `tickets` — **nouvelle table**

**Rôle** — droit d'accès matérialisable en QR code. **Propriété** `EVENT-OWNED`. **Suppression** `REVOKE_NOT_DELETE`.

Le corpus mentionne « rotation des clés QR » (Document B §28), « QR signing » (§40.2) et redacte `qrPayload` / `qrSignature` / `qrSecret` (Document D §30) — sans aucun modèle.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `tkt_` — **jamais** dans le QR |
| `organization_id` `event_id` `registration_id` | TEXT FK | non | |
| `public_reference` | TEXT | non | identifiant opaque **porté par le QR**, 128 bits |
| `token_hash` | TEXT | non | HMAC-SHA-256 du secret du ticket |
| `key_id` | TEXT | non | `kid` de la clé de signature QR — permet la rotation |
| `payload_version` | INTEGER | non | version du format de payload |
| `status` | TEXT | non | `ISSUED` `ACTIVE` `USED` `REVOKED` `EXPIRED` `REPLACED` |
| `issued_at` | TIMESTAMPTZ | non | |
| `valid_from` `valid_until` | TIMESTAMPTZ | oui | |
| `revoked_at` `revoked_by` `revocation_reason` | | oui | |
| `replaced_by_ticket_id` | TEXT FK self | oui | régénération |
| `delivery_status` | TEXT | non | `PENDING` `SENT` `FAILED` `NOT_APPLICABLE` |
| `created_at` `updated_at` | | non | |

**Index** — `ux_tickets_public_reference(public_reference)` · `ux_tickets_token_hash(token_hash)` · `ux_tickets_registration_active(registration_id) WHERE status IN ('ISSUED','ACTIVE')` · `ix_tickets_org_event_status(organization_id, event_id, status)` · `ix_tickets_event_status(event_id, status)`

**Contraintes de sécurité** — le QR ne contient **jamais** `id`, ni email, ni nom, ni identifiant séquentiel (contexte produit §9.8). Il contient : `public_reference`, `key_id`, `payload_version`, une signature. Le secret n'est **jamais** stocké en clair — seul son HMAC l'est, exactement comme un refresh token. Le rejeu est borné par le nonce anti-rejeu Redis (90 s, [ADR-0009](../adr/0009-token-and-session-lifetimes.md)) **et** par la détection de doublon sur `attendance_records`. Une rotation de clé QR change `key_id` ; les anciens tickets restent vérifiables pendant la fenêtre de coexistence.

---

### 7.5 `attendance_records` — **nouvelle table**

**Rôle** — enregistrement de présence. **Propriété** `EVENT-OWNED`. **Suppression** `APPEND_ONLY`.

C'est le cœur du produit. Rien ici n'est modifiable après écriture.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `att_` |
| `organization_id` `event_id` | TEXT FK | non | |
| `event_session_id` | TEXT FK | oui | `NULL` = check-in au niveau événement |
| `registration_id` `participant_id` | TEXT FK | non | |
| `ticket_id` | TEXT FK `tickets` | oui | `NULL` si saisie manuelle |
| `record_type` | TEXT | non | `CHECK_IN` `CHECK_OUT` `CORRECTION` |
| `result` | TEXT | non | `ACCEPTED` `REFUSED` `DUPLICATE` |
| `refusal_reason` | TEXT | oui | `TICKET_REVOKED` `SESSION_CLOSED` `NOT_REGISTERED` `OUTSIDE_WINDOW` `ALREADY_CHECKED_IN` `EVENT_NOT_ACTIVE` `SIGNATURE_INVALID` |
| `scanner_device_id` | TEXT FK | oui | |
| `operator_membership_id` | TEXT FK | oui | |
| `scan_method` | TEXT | non | `QR_SCAN` `MANUAL_CODE` `MANUAL_SEARCH` |
| `server_recorded_at` | TIMESTAMPTZ | non | **seul horodatage faisant foi** |
| `client_recorded_at` | TIMESTAMPTZ | oui | déclaratif, **jamais** autoritaire |
| `sync_batch_id` | TEXT | oui | lot de synchronisation offline |
| `idempotency_key` | TEXT | oui | clé de l'opération cliente |
| `corrects_record_id` | TEXT FK self | oui | pour `record_type = CORRECTION` |
| `request_id` | TEXT | oui | corrélation logs |
| `metadata` | JSONB | non | défaut `'{}'` |
| `created_at` | TIMESTAMPTZ | non | |

**Index** — `ux_attendance_checkin_unique(event_id, registration_id, event_session_id) WHERE record_type='CHECK_IN' AND result='ACCEPTED'` · `ux_attendance_idempotency(organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL` · `ix_attendance_org_event_time(organization_id, event_id, server_recorded_at DESC)` · `ix_attendance_session_time(event_session_id, server_recorded_at DESC)` · `ix_attendance_participant(participant_id, server_recorded_at DESC)` · `ix_attendance_device_time(scanner_device_id, server_recorded_at DESC)` · `ix_attendance_result(event_id, result) WHERE result <> 'ACCEPTED'` · `ix_attendance_sync_batch(sync_batch_id) WHERE sync_batch_id IS NOT NULL`

**Contraintes**

`ux_attendance_checkin_unique` est **la** garantie anti-doublon. Elle vit dans la base, pas dans le code : deux scans concurrents du même ticket, arrivant sur deux instances, ne peuvent pas produire deux check-ins acceptés. Le second reçoit une violation d'unicité, traduite en `result = DUPLICATE`.

`ux_attendance_idempotency` complète : le même lot offline rejoué n'écrit rien de nouveau.

Les refus **sont enregistrés** (`result = REFUSED`) avec leur motif. Un refus non tracé est un refus non analysable — et le contexte produit §9.10 exige explicitement le « refus explicite avec raison ».

**Résolution de conflit offline** — le serveur arbitre toujours. `client_recorded_at` est conservé pour l'analyse et n'entre **jamais** dans une décision d'autorisation ni dans un ordonnancement faisant foi.

**Audit** — pas d'`updated_at`, pas de `deleted_at`, pas de `version` : append-only. Une erreur se corrige par une ligne `CORRECTION` pointant sur la ligne fautive.

---

### 7.6 `scanner_devices`

**Propriété** `ORGANIZATION-OWNED`. **Suppression** `SOFT_DELETE`.

Colonnes : `id`, `organization_id` FK, `name`, `device_identifier`, `platform` (`ANDROID` `IOS` `WEB`), `app_version`, `status` (`PENDING` `ACTIVE` `SUSPENDED` `REVOKED` `LOST`), `registered_at`, `registered_by`, `last_seen_at`, `revoked_at`, `revoked_by`, `revocation_reason`, transverses, soft delete.

**Index** — **`ux_scanner_device_identifier(organization_id, device_identifier) WHERE deleted_at IS NULL`** · `ix_scanner_devices_org_status(organization_id, status)` · `ix_scanner_devices_last_seen(organization_id, last_seen_at DESC)`

L'index du Document A était **globalement** unique sur `device_identifier` seul. Cela viole la règle tenant-first du Document A §8.1 et crée un canal transverse : le tenant A peut détecter qu'un identifiant est déjà pris par le tenant B, et le lui bloquer. Corrigé (C-30).

---

### 7.7 `scanner_device_assignments`

**Propriété** `EVENT-OWNED`. **Suppression** `REVOKE_NOT_DELETE`.

Colonnes : `id`, `organization_id` FK, `scanner_device_id` FK, `membership_id` FK, `event_id` FK, `allowed_session_ids` `TEXT[]` (vide = toutes les sessions de l'événement), `status`, `assigned_at`, `assigned_by`, `valid_from`, `valid_until`, `revoked_at`, `revoked_by`, `created_at`.

**Index** — `ux_scanner_assignment_active(scanner_device_id, event_id, membership_id) WHERE revoked_at IS NULL` · `ix_scanner_assignment_device_status(scanner_device_id, status)` · `ix_scanner_assignment_membership(membership_id, status)` · `ix_scanner_assignment_event(event_id, status)` · `ix_scanner_assignment_org(organization_id, event_id)`

**Contraintes** — révoquer cette ligne coupe l'accès opérationnel **sans** toucher au membership : c'est la voie de révocation d'un appareil perdu.

---

## 8. Domaine support

### 8.1 `security_events`

**Propriété** mixte. **Suppression** `APPEND_ONLY`. Rétention **12 mois**.

Colonnes : `id`, `event_type`, `severity` (`INFO` `LOW` `MEDIUM` `HIGH` `CRITICAL` — non énumérés dans le Document A), `result` (`SUCCESS` `FAILURE` `DENIED` — idem), `reason_code`, `user_id`, `session_id`, `organization_id`, `membership_id`, `device_id`, `request_id`, `trace_id`, `ip_address`, `user_agent`, `metadata` JSONB, `occurred_at`, `created_at`.

**`event_type`** — union des quatre catalogues concurrents du corpus (C-11) : les 12 du Document A, les 23 du Document B, plus `SESSION_COMPROMISED`, `ROLE_ESCALATION_ATTEMPTED`, `RATE_LIMIT_EXCEEDED` (Document D §21) et `ORGANIZATION_KILL_SWITCH_EXECUTED` (Document D §35), plus les nouveaux : `ORGANIZATION_CONTEXT_SWITCHED`, `TICKET_SIGNATURE_INVALID`, `TICKET_REPLAY_DETECTED`, `SCANNER_DEVICE_REVOKED`, `IDEMPOTENCY_CONFLICT_DETECTED`, `UNSCOPED_QUERY_EXECUTED`, `SIGNING_KEY_ROTATED`. Catalogue complet : [`AUTHENTICATION_AUTHORIZATION.md`](../security/AUTHENTICATION_AUTHORIZATION.md).

**Index** — `ix_security_events_type_time(event_type, occurred_at DESC)` · `ix_security_events_user_time(user_id, occurred_at DESC) WHERE user_id IS NOT NULL` · `ix_security_events_org_time(organization_id, occurred_at DESC) WHERE organization_id IS NOT NULL` · `ix_security_events_severity_time(severity, occurred_at DESC)` · `ix_security_events_request(request_id) WHERE request_id IS NOT NULL`

**Contraintes** — jamais de secret dans `metadata` (Document D §30). La rétention de la table PostgreSQL (12 mois) est **distincte** de celle de l'index de logs (Document D §34) : ce sont deux systèmes, et les confondre est l'erreur C-15.

---

### 8.2 `audit_logs`

**Propriété** mixte. **Suppression** `APPEND_ONLY`. Rétention selon obligations métier.

Colonnes : `id`, `actor_user_id`, `actor_session_id`, `actor_role` (snapshot textuel — le rôle **au moment de l'action**, insensible aux changements ultérieurs), `organization_id`, `target_type`, `target_id`, `action`, `previous_values` JSONB, `new_values` JSONB, `reason`, `request_id`, `ip_address`, `occurred_at`.

**Index** — `ix_audit_org_time(organization_id, occurred_at DESC)` · `ix_audit_actor_time(actor_user_id, occurred_at DESC)` · `ix_audit_target(target_type, target_id, occurred_at DESC)` · `ix_audit_action_time(action, occurred_at DESC)` · `ix_audit_request(request_id) WHERE request_id IS NOT NULL`

**Contraintes** — `previous_values` / `new_values` ne contiennent **jamais** de hash de mot de passe, de secret MFA ni de token. Les champs sensibles sont remplacés par `"[REDACTED]"`, jamais omis — l'omission masquerait le fait qu'ils ont changé.

---

### 8.3 `idempotency_records` — **nouvelle table**

**Propriété** `ORGANIZATION-OWNED` nullable (les opérations plateforme n'ont pas d'organisation). Voir [ADR-0012](../adr/0012-idempotency-storage.md).

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `idm_` |
| `organization_id` | TEXT FK | oui | |
| `actor_id` | TEXT | non | utilisateur ou appareil |
| `actor_session_id` | TEXT FK | oui | |
| `method` | TEXT | non | |
| `route` | TEXT | non | **gabarit** (`/api/v1/events/:eventId/check-ins`), jamais l'URI concrète |
| `idempotency_key` | TEXT | non | fourni par le client |
| `request_hash` | TEXT | non | SHA-256 de l'empreinte canonique |
| `status` | TEXT | non | `PENDING` `COMPLETED` `FAILED_RETRYABLE` `FAILED_FINAL` `EXPIRED` |
| `response_status` | INTEGER | oui | |
| `response_body` | JSONB | oui | |
| `response_ref` | TEXT | oui | pour les réponses volumineuses |
| `created_at` `expires_at` | TIMESTAMPTZ | non | |
| `locked_until` | TIMESTAMPTZ | oui | |

**Index** — `ux_idempotency_scope(organization_id, actor_id, method, route, idempotency_key)` · `ix_idempotency_expires(expires_at)` · `ix_idempotency_status_created(status, created_at)`

**Contraintes** — la réservation est un `INSERT … ON CONFLICT DO NOTHING`. Aucun verrou : l'index unique **est** le mécanisme atomique. Rétention 24 h, **7 j** pour les routes de synchronisation attendance.

---

### 8.4 `outbox_events` — **nouvelle table**

**Rôle** — publication fiable d'événements internes après commit. **Propriété** `ORGANIZATION-OWNED` nullable. **Suppression** `APPEND_ONLY` + purge.

Le contexte produit §12.6 exige que « le workflow métier produise un événement interne après commit », qu'un adaptateur SSE ou Socket.IO diffuse ensuite. Sans table d'outbox, un crash entre le commit et la publication perd l'événement en silence — le tableau de bord temps réel divergerait de la base sans que personne ne le sache.

| Colonne | Type | Null | Sens |
|---|---|---|---|
| `id` | TEXT PK | non | `obx_` |
| `organization_id` | TEXT FK | oui | |
| `event_id` | TEXT FK `events` | oui | |
| `event_type` | TEXT | non | `ATTENDANCE_RECORDED`, `EVENT_ACTIVATED`, … |
| `payload_version` | INTEGER | non | |
| `payload` | JSONB | non | |
| `aggregate_type` `aggregate_id` | TEXT | non | |
| `status` | TEXT | non | `PENDING` `PUBLISHED` `FAILED` |
| `attempts` | INTEGER | non | défaut `0` |
| `available_at` | TIMESTAMPTZ | non | backoff |
| `published_at` `last_error` | | oui | |
| `request_id` `trace_id` | TEXT | oui | |
| `created_at` | | non | |

**Index** — `ix_outbox_pending(status, available_at) WHERE status='PENDING'` · `ix_outbox_org_created(organization_id, created_at DESC)` · `ix_outbox_aggregate(aggregate_type, aggregate_id)`

**Contraintes** — l'écriture dans l'outbox se fait **dans la même transaction** que le changement métier. Un consommateur la relaie ensuite vers BullMQ ou SSE. Livraison *at-least-once* : les consommateurs doivent être idempotents. Purge des `PUBLISHED` après 7 jours.

---

## 9. Invariants inter-tables

Tous vérifiés par trigger **et** en test d'intégration. Un invariant qui ne repose que sur du code applicatif n'est pas un invariant.

| # | Invariant |
|---|---|
| INV-01 | `event_user_assignments.organization_id` = `events.organization_id` = `organization_memberships.organization_id` |
| INV-02 | `user_sessions.user_id` = `organization_memberships.user_id` et `user_sessions.organization_id` = `organization_memberships.organization_id` |
| INV-03 | `scanner_devices.organization_id` = `organization_memberships.organization_id` = `events.organization_id` |
| INV-04 | `event_sessions.organization_id` = `events.organization_id` |
| INV-05 | `registrations.organization_id` = `events.organization_id` = `participants.organization_id` |
| INV-06 | `registration_sessions.event_id` = `registrations.event_id` = `event_sessions.event_id` |
| INV-07 | `tickets.organization_id` = `registrations.organization_id`, `tickets.event_id` = `registrations.event_id` |
| INV-08 | `attendance_records.organization_id` = `events.organization_id`, et si `event_session_id` est renseigné, `event_sessions.event_id` = `attendance_records.event_id` |
| INV-09 | Un rôle de portée `PLATFORM` n'apparaît que dans `platform_role_assignments` ; `ORGANIZATION` que dans `membership_role_assignments` ; `EVENT` que dans `event_user_assignments` |
| INV-10 | Il existe toujours au moins un `platform_role_assignments` actif de rôle `SUPER_ADMIN` |
| INV-11 | Tout utilisateur portant `SUPER_ADMIN` possède au moins une `mfa_methods` de statut `ACTIVE` |
| INV-12 | `user_sessions.organization_id` et `active_membership_id` sont tous deux `NULL` ou tous deux renseignés |

---

## 10. Index transverses

| Règle | Application |
|---|---|
| **Tenant-first** | Tout index d'une table tenant-owned commence par `organization_id` |
| **Statut** | Toute colonne `status` filtrée fréquemment est indexée avec le tenant en tête |
| **Partiels** | `WHERE deleted_at IS NULL` sur les uniques des tables soft-delete ; `WHERE revoked_at IS NULL` sur les assignations ; `WHERE status='ACTIVE'` sur les expirations |
| **Temporels** | Les listes triées par date portent `(organization_id, created_at DESC)` — l'ordre est celui du tri par défaut du Document C §15.4 |
| **Départage** | Toute pagination par curseur trie sur `(created_at DESC, id DESC)`. `created_at` seul ne suffit pas : deux lignes de même horodatage produiraient une pagination instable |
| **JSONB** | Aucun index GIN au MVP. À ajouter uniquement sur besoin de requête mesuré |

---

## 11. Corrections apportées au Document A

| # | Correction | Motif |
|---|---|---|
| C-1 | Aucune colonne `current_refresh_token_hash` sur `user_sessions` | Deux dépôts = deux vérités pour l'invariant de rotation. [ADR-0014](../adr/0014-refresh-token-hash-single-store.md) |
| C-10 | `events` entièrement définie | Table fantôme : 3 FK pointaient dessus sans aucune définition |
| C-11 | Enum `security_events.event_type` élargi à l'union des 4 catalogues | Le Document D exigeait d'y enregistrer des types que l'enum ne pouvait pas stocker |
| C-27 | `ux_refresh_active_per_family` ajouté | Le Document A affirmait l'invariant sans l'indexer |
| C-28 | Index MFA scindé en `PENDING` / `ACTIVE` | L'index combiné rendait tout ré-enrôlement impossible |
| C-29 | `ck_sessions_tenant_coherence` ajouté | Colonnes nullables déclarées « cohérentes » sans définition du cas plateforme |
| C-30 | `ux_scanner_device_identifier` scopé au tenant | Unicité globale = canal transverse entre tenants + violation du tenant-first |
| C-12 | Quatre concepts de `version` distingués | Voir tableau ci-dessous |

**Les quatre `version`**, longtemps confondus (C-12) :

| Concept | Emplacement | Rôle |
|---|---|---|
| `users.version` | colonne | invalide les access tokens en circulation (claim `ver`) |
| `user_credentials.password_version` | colonne | profil de paramètres Argon2id, déclenche le rehash |
| `permissionsVersion` | Redis + miroir | invalide le cache de permissions ([ADR-0004](../adr/0004-permission-resolution-and-caching.md)) |
| `version` métier | `events`, `participants`, `registrations`, … | verrou optimiste, exposé en ETag (Document C §20) |

---

## 12. Ordre d'implémentation

14 migrations. **Les migrations 1 à 8 conservent exactement la séquence du Document A §11** : ce qui a déjà été raisonné n'est pas invalidé.

| # | Migration | Contenu | Sprint |
|---:|---|---|---:|
| 1 | `identity_core` | `users`, `user_credentials`, `organizations`, `organization_memberships` | 03 |
| 2 | `authorization_core` | `roles`, `permissions`, `role_permissions`, `membership_role_assignments`, `platform_role_assignments` | 03 |
| 3 | `events_core` | `events`, `event_sessions`, `event_user_assignments` | 03 |
| 4 | `invitations_and_verification` | `user_invitations`, `email_verification_tokens` | 04 |
| 5 | `sessions_and_rotations` | `user_sessions`, `refresh_token_rotations` | 04 |
| 6 | `passwords_and_mfa` | `password_reset_tokens`, `mfa_methods`, `mfa_recovery_codes` | 04 |
| 7 | `scanner_devices` | `scanner_devices`, `scanner_device_assignments` | 11 |
| 8 | `audit_and_security` | `security_events`, `audit_logs` | 03 |
| 9 | `participants` | `participants` | 10 |
| 10 | `registrations` | `registrations`, `registration_sessions` | 10 |
| 11 | `tickets` | `tickets` | 11 |
| 12 | `attendance` | `attendance_records` | 12 |
| 13 | `idempotency` | `idempotency_records` | 05 |
| 14 | `outbox` | `outbox_events` | 12 |

La migration 8 est appliquée dès le sprint 03 malgré son rang : l'audit doit exister **avant** la première écriture métier, sinon les premières opérations ne sont pas tracées et le trou est définitif.

Procédure de validation par migration, stratégie expand/contract, seed et rollback : [`MIGRATION_STRATEGY.md`](MIGRATION_STRATEGY.md).
