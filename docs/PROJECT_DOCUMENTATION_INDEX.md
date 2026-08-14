# Eventini — Index de la documentation

> **Point d'entrée canonique de toute la documentation.** · **Version :** 1.0 · **Date :** 30 juillet 2026

---

## 1. Par où commencer

| Vous êtes | Lisez dans cet ordre |
|---|---|
| **Nouveau sur le projet** | [Contexte produit](00-project-context/EVENTINI_PROJECT_CONTEXT.md) → [Architecture système](architecture/SYSTEM_ARCHITECTURE.md) → [Feuille de route](sprints/IMPLEMENTATION_ROADMAP.md) |
| **Agent IA avant de coder** | [Contexte produit §21](00-project-context/EVENTINI_PROJECT_CONTEXT.md) → [Architecture système §3](architecture/SYSTEM_ARCHITECTURE.md) (état réel) → [ADR](adr/README.md) → le sprint concerné |
| **Sur le point d'implémenter** | [Index des sprints](sprints/SPRINT_PLAN.md) → le dossier du sprint concerné → le document de spécification cité par le ticket |
| **Sur le point de toucher la sécurité** | [ADR](adr/README.md) → [Authentification et autorisation](security/AUTHENTICATION_AUTHORIZATION.md) → [Modèle de menace](security/THREAT_MODEL.md) |
| **Sur le point de toucher la base** | [Schéma](database/DATABASE_SCHEMA.md) → [Relations](database/ENTITY_RELATIONSHIPS.md) → [Migrations](database/MIGRATION_STRATEGY.md) |
| **En train de déployer** | [Variables d'environnement](operations/ENVIRONMENT_VARIABLES.md) → [Migrations §7](database/MIGRATION_STRATEGY.md) |

---

## 2. Règle de précédence

En cas de conflit, dans cet ordre :

1. **le code et les migrations** décrivent l'état réel ;
2. **un ADR accepté** prime sur toute convention générale ;
3. **une décision récente explicitement validée** prime sur un document plus ancien ;
4. **le document propriétaire du sujet** (§4) prime sur une mention de passage ;
5. **le contexte produit** décrit l'intention cible.

Un document non listé ici n'est pas normatif.

---

## 3. Catalogue

### Contexte

| Document | Statut | Rôle |
|---|---|---|
| [`00-project-context/EVENTINI_PROJECT_CONTEXT.md`](00-project-context/EVENTINI_PROJECT_CONTEXT.md) | **canonique**, partiellement supersédé | Périmètre, acteurs, états métier, workflows, Definition of Done §19 |

### Architecture

| Document | Statut | Rôle |
|---|---|---|
| [`architecture/SYSTEM_ARCHITECTURE.md`](architecture/SYSTEM_ARCHITECTURE.md) | normatif | C4, topologie, cycle de requête, **état réel audité §3** |
| [`architecture/BACKEND_ARCHITECTURE.md`](architecture/BACKEND_ARCHITECTURE.md) | normatif | Couches, bootstrap, ordre des guards, transactions, corrections de dépendances |
| [`architecture/FRONTEND_ARCHITECTURE.md`](architecture/FRONTEND_ARCHITECTURE.md) | normatif | App Router, client API, état, **12 défauts F-1 à F-12** |
| [`architecture/MODULE_DEPENDENCY_MAP.md`](architecture/MODULE_DEPENDENCY_MAP.md) | normatif | Graphe complet, arêtes interdites, application automatique |
| [`architecture/authentication-folder-migration.md`](architecture/authentication-folder-migration.md) | ⛔ **obsolète** | Historique uniquement — tous ses chemins sont faux |

### Base de données

| Document | Statut | Rôle |
|---|---|---|
| [`database/DATABASE_SCHEMA.md`](database/DATABASE_SCHEMA.md) | normatif | **30 tables**, colonnes, index, contraintes, propriété tenant, suppression |
| [`database/ENTITY_RELATIONSHIPS.md`](database/ENTITY_RELATIONSHIPS.md) | normatif | Chaîne de propriété, diagrammes, requêtes d'autorisation, machines à états |
| [`database/MIGRATION_STRATEGY.md`](database/MIGRATION_STRATEGY.md) | normatif | 14 migrations, expand/contract, seed, rollback, promotion |
| [`database/USER_MANAGEMENT_DATA_MODEL.md`](database/USER_MANAGEMENT_DATA_MODEL.md) | baseline (Doc A) | 21 tables d'origine, conventions d'index, politique de soft delete |

### Sécurité

| Document | Statut | Rôle |
|---|---|---|
| [`security/AUTHENTICATION_AUTHORIZATION.md`](security/AUTHENTICATION_AUTHORIZATION.md) | normatif | **Tous les nombres**, cookies, CSRF, flux, chaîne en 8 étapes, 25 tests |
| [`security/RATE_LIMITING_AND_ABUSE_PREVENTION.md`](security/RATE_LIMITING_AND_ABUSE_PREVENTION.md) | normatif | Limites chiffrées, échelle de lockout, `429`, anti-abus |
| [`security/THREAT_MODEL.md`](security/THREAT_MODEL.md) | normatif | STRIDE, OWASP, 5 scénarios Eventini, **8 risques acceptés** |
| [`security/AUTHENTICATION_SECURITY_BASELINE.md`](security/AUTHENTICATION_SECURITY_BASELINE.md) | baseline (Doc B) | **Invariants AUTH-INV-001 à 012**, cycle de session, STRIDE, NFR |

### API

| Document | Statut | Rôle |
|---|---|---|
| [`api/API_CONVENTIONS.md`](api/API_CONVENTIONS.md) | normatif | Enveloppe RFC 9457, catalogue d'erreurs, pagination, **table des routes** |
| [`api/IDEMPOTENCY_AND_CONCURRENCY.md`](api/IDEMPOTENCY_AND_CONCURRENCY.md) | normatif | Empreinte, machine à états, synchronisation offline, verrou optimiste |
| [`api/SAAS_HTTP_API_GUIDELINES.md`](api/SAAS_HTTP_API_GUIDELINES.md) | baseline (Doc C) | Règles génériques : statuts, pagination, idempotence, headers |

### Infrastructure et exploitation

| Document | Statut | Rôle |
|---|---|---|
| [`infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md`](infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md) | normatif | Catalogue de clés, TTL, **4 scripts Lua vérifiés en exécution** |
| [`operations/GIT_STRATEGY.md`](operations/GIT_STRATEGY.md) | normatif | **`master` + `develop`**, flux feature/release/hotfix, **calendrier des releases**, protection de branches |
| [`operations/ENVIRONMENT_VARIABLES.md`](operations/ENVIRONMENT_VARIABLES.md) | normatif | Catalogue complet, **14 règles de validation bloquante** |
| [`observability/PINO_LOGGING_SPECIFICATION.md`](observability/PINO_LOGGING_SPECIFICATION.md) | baseline (Doc D) | **Schéma de champs canonique**, niveaux, catégories, redaction, rétention |

### Livraison

| Document | Statut | Rôle |
|---|---|---|
| [`sprints/IMPLEMENTATION_ROADMAP.md`](sprints/IMPLEMENTATION_ROADMAP.md) | normatif | **Séquence unique**, 5 invariants d'ordre, critères de sortie, 4 jalons |
| [`sprints/SPRINT_PLAN.md`](sprints/SPRINT_PLAN.md) | normatif | **Index des sprints** + conventions communes : branches, commits, PR, checks, DoR, DoD |
| [`sprints/sprint-01/`](sprints/sprint-01/README.md) … [`sprint-12/`](sprints/sprint-12/README.md) | normatif | **Un dossier par sprint**, 73 tickets détaillés avec tests négatifs et risques |
| [`adr/README.md`](adr/README.md) | normatif | 17 décisions |

### Les 12 sprints

| Sprint | Thème | Tickets | Jalon |
|---|---|---|---|
| [01](sprints/sprint-01/README.md) | Stabilisation du dépôt | EVT-001 → 007 | |
| [02](sprints/sprint-02/README.md) | Bootstrap sécurisé | EVT-008 → 013 | |
| [03](sprints/sprint-03/README.md) | Base de données | EVT-014 → 019 | 🏁 M1 |
| [04](sprints/sprint-04/README.md) | Authentification cœur | EVT-020 → 027 | |
| [05](sprints/sprint-05/README.md) | Sécurité web | EVT-028 → 032 | |
| [06](sprints/sprint-06/README.md) | Multi-tenant et autorisation | EVT-033 → 036 | 🏁 **M2** |
| [07](sprints/sprint-07/README.md) | Frontend authentification | EVT-037 → 041 | |
| [08](sprints/sprint-08/README.md) | Organisations | EVT-042 → 047 | |
| [09](sprints/sprint-09/README.md) | Événements et sessions | EVT-048 → 053 | 🏁 M3 |
| [10](sprints/sprint-10/README.md) | Participants et inscriptions | EVT-054 → 059 | |
| [11](sprints/sprint-11/README.md) | Tickets, QR et scanners | EVT-060 → 065 | |
| [12](sprints/sprint-12/README.md) | Présence, offline et temps réel | EVT-066 → 073 | 🏁 **M4 MVP** |

### Artefacts exécutables

| Chemin | Rôle |
|---|---|
| [`../scripts/redis/`](../scripts/redis/) | 4 scripts Lua — **le seul livrable de ce lot réellement exécutable, et réellement exécuté** |
| [`../.github/workflows/`](../.github/workflows/) | CI honnête : les jobs non activables portent un `TODO` nommant leur sprint |
| [`../.github/pull_request_template.md`](../.github/pull_request_template.md) | Definition of Done + impact sécurité + tests négatifs |

---

## 4. Qui fait autorité sur quoi

Un sujet, un propriétaire. Une mention de passage ailleurs ne fait pas autorité.

| Sujet | Propriétaire |
|---|---|
| Périmètre produit, acteurs, états métier, Definition of Done | Contexte produit |
| Tables, colonnes, index, contraintes | `DATABASE_SCHEMA.md` |
| Relations, invariants, machines à états, effets de transition | `ENTITY_RELATIONSHIPS.md` |
| Migrations, seed, rollback | `MIGRATION_STRATEGY.md` |
| Paramètres crypto, TTL, cookies, CSRF, flux, chaîne d'autorisation | `AUTHENTICATION_AUTHORIZATION.md` |
| Invariants AUTH-INV, cycle de session, STRIDE d'origine, NFR | Document B |
| Limites, lockout, `429`, anti-abus | `RATE_LIMITING_AND_ABUSE_PREVENTION.md` |
| Menaces, risques acceptés | `THREAT_MODEL.md` |
| Enveloppe, codes d'erreur, pagination, routes | `API_CONVENTIONS.md` |
| Statuts HTTP, règles génériques REST | Document C |
| Idempotence, concurrence | `IDEMPOTENCY_AND_CONCURRENCY.md` |
| Clés Redis, TTL, Lua | `REDIS_KEYS_AND_LUA_SCRIPTS.md` |
| Champs de log, niveaux, redaction, rétention | Document D |
| Variables d'environnement | `ENVIRONMENT_VARIABLES.md` |
| Séquence, sprints, processus | `IMPLEMENTATION_ROADMAP.md`, `SPRINT_PLAN.md` |
| Branches, releases, tags, hotfix | `GIT_STRATEGY.md` |
| **Toute décision fermant un choix ouvert** | l'ADR correspondant |

---

## 5. Registre de réconciliation — C-1 à C-31

Le corpus d'origine contenait 31 contradictions identifiées. Chacune est ici tranchée. **Aucune n'est laissée ouverte.**

### Contradictions inter-documents

| # | Contradiction | Résolution | Référence |
|---|---|---|---|
| **C-1** | Doc B place `currentRefreshTokenHash` sur la session ; Doc A ne l'a pas | **Une seule source** : `refresh_token_rotations.token_hash`. Aucune colonne sur `user_sessions` | [ADR-0014](adr/0014-refresh-token-hash-single-store.md) |
| **C-2** | Doc B `/auth/login` viole les règles d'URI du Doc C | Sous-ressources nominales sous `/api/v1/auth/` | [ADR-0010](adr/0010-auth-route-naming.md) |
| **C-3** | Enveloppe d'erreur : `{code,message}` vs RFC 9457 | **RFC 9457**, les codes `AUTH_*` deviennent des valeurs de `code` | [ADR-0008](adr/0008-response-envelope-rfc9457.md) |
| **C-4** | `meta` : `{requestId}` vs `{requestId,timestamp,apiVersion}` | Les **trois**, toujours | [ADR-0008](adr/0008-response-envelope-rfc9457.md) |
| **C-5** | `AUTH_PERMISSION_DENIED` vs `PERMISSION_DENIED` | Espace unique ; préfixe `AUTH_` = domaine, pas provenance | [`API_CONVENTIONS.md` §4](api/API_CONVENTIONS.md) |
| **C-6** | `tenantId` interdit par Doc D, utilisé partout par Doc C, claim JWT dans Doc B | **`organizationId` partout**, claim `org` | [ADR-0006](adr/0006-organizationid-terminology.md) |
| **C-7** | Deux schémas de log concurrents | **Doc D §9 l'emporte** | [ADR-0006](adr/0006-organizationid-terminology.md) |
| **C-8** | Doc B liste 13 entités, Doc A en impose 21 | **30 tables**, Doc A repris intégralement | [`DATABASE_SCHEMA.md`](database/DATABASE_SCHEMA.md) |
| **C-9** | L'idempotence exige une table absente du plan | Table `idempotency_records`, migration 13 | [ADR-0012](adr/0012-idempotency-storage.md) |
| **C-10** | `events` référencée par 3 FK, jamais définie | **Définie intégralement** | [`DATABASE_SCHEMA.md` §6.1](database/DATABASE_SCHEMA.md) |
| **C-11** | 4 catalogues de security events non identiques | **Union des 4** + nouveaux codes | [`AUTHENTICATION_AUTHORIZATION.md` §8](security/AUTHENTICATION_AUTHORIZATION.md) |
| **C-12** | 4 notions de `version` confondues | **4 rôles distincts documentés** | [`DATABASE_SCHEMA.md` §11](database/DATABASE_SCHEMA.md) |
| **C-13** | Casse et racines divergentes des champs de session | snake_case en base, camelCase en API ; `user_agent` normalisé, `ip_address` tronqué | [`DATABASE_SCHEMA.md` §4.3](database/DATABASE_SCHEMA.md) |
| **C-14** | Les docs disent `api/`, le dépôt dit `backend/` | **`backend/`** ; vérifié par un job CI | [`SYSTEM_ARCHITECTURE.md` §3.6](architecture/SYSTEM_ARCHITECTURE.md) |
| **C-15** | Rétention des logs confondue avec celle de `security_events` | **Deux systèmes distincts** : table PostgreSQL 12 mois, index de logs selon Doc D §34 | [`DATABASE_SCHEMA.md` §8.1](database/DATABASE_SCHEMA.md) |

### Contradictions internes

| # | Contradiction | Résolution | Référence |
|---|---|---|---|
| **C-16** | CSRF exige une session active sur un endpoint pré-authentification — **le login était inimplémentable** | Deux modes de liaison + rebinding au login | [ADR-0016](adr/0016-pre-session-csrf-binding.md) |
| **C-17** | Choix « ou » non tranchés présentés comme baseline | `SameSite=Strict` pour le refresh · `Path=/api/v1/auth/sessions` · double-submit signé · `SCANNER` de portée `EVENT` | [ADR-0015](adr/0015-scanner-role-scope.md), [ADR-0016](adr/0016-pre-session-csrf-binding.md) |
| **C-18** | Trois conventions de préfixe de cookie | Règle unique ; `__Host-` ajouté au cookie CSRF | [ADR-0016](adr/0016-pre-session-csrf-binding.md) |
| **C-19** | Suppression de cookie omettant `HttpOnly` | `HttpOnly` **inclus** dans les attributs à rejouer | [`AUTHENTICATION_AUTHORIZATION.md` §2](security/AUTHENTICATION_AUTHORIZATION.md) |
| **C-20** | « éviter `X-*` » vs `X-Request-Id` imposé | `X-Request-Id` conservé — aucun standard ne le remplace ; exception documentée | [`API_CONVENTIONS.md` §9](api/API_CONVENTIONS.md) |
| **C-21** | 7 conventions « à choisir » jamais choisies | **Toutes tranchées** : `limit` 20/100 · `DELETE` → `204` · action → `204` · filtres par répétition · en vol → `409` · rétention 24 h/7 j · repli fail closed sur l'auth | [ADR-0008](adr/0008-response-envelope-rfc9457.md), [ADR-0011](adr/0011-redis-lua-atomic-operations.md), [ADR-0012](adr/0012-idempotency-storage.md) |
| **C-22** | `PRECONDITION_FAILED` utilisé, absent du catalogue | **Ajouté** | [`API_CONVENTIONS.md` §4](api/API_CONVENTIONS.md) |
| **C-23** | `csrfToken` redacté alors qu'il est déclaré non sensible | Redaction **conservée** — défense en profondeur ; incohérence assumée et notée | [`PINO_LOGGING_SPECIFICATION.md`](observability/PINO_LOGGING_SPECIFICATION.md) entête |
| **C-24** | Les chemins de redaction ne sont pas des `redact.paths` Pino valides | ✅ **RÉSOLU** (EVT-011). Les wildcards sont ajoutés, mais ils ne suffisaient pas : vérifié que `*` ne couvre **qu'un seul** niveau et que `**` ne récurse pas. Un scrubber récursif indépendant de la profondeur complète les chemins | [`sprint-02`](sprints/sprint-02/README.md#evt-011) |
| **C-25** | `log-serializers.ts` promis, jamais spécifié | ✅ **RÉSOLU** (EVT-011). Serializers `req`/`res`/`err` spécifiés en **listes blanches** — les défauts de `pino-std-serializers` émettaient tous les en-têtes et la query string | [`sprint-02`](sprints/sprint-02/README.md#evt-011) |
| **C-26** | Niveau de log en test : `silent` ou `error` | **`silent`** | [`ENVIRONMENT_VARIABLES.md` §12](operations/ENVIRONMENT_VARIABLES.md) |
| **C-27** | « un seul token `ACTIVE` par famille » sans index | `ux_refresh_active_per_family` **ajouté** | [ADR-0014](adr/0014-refresh-token-hash-single-store.md) |
| **C-28** | L'index MFA **empêchait tout ré-enrôlement** | Scindé en deux index partiels `PENDING` / `ACTIVE` | [`DATABASE_SCHEMA.md` §4.7](database/DATABASE_SCHEMA.md) |
| **C-29** | Colonnes de session nullables déclarées « cohérentes » | `ck_sessions_tenant_coherence` **ajouté** | [`DATABASE_SCHEMA.md` §4.3](database/DATABASE_SCHEMA.md) |
| **C-30** | `device_identifier` **globalement** unique — canal transverse entre tenants | Scopé : `(organization_id, device_identifier)` | [`DATABASE_SCHEMA.md` §7.6](database/DATABASE_SCHEMA.md) |
| **C-31** | Doc E décrit deux résolutions de la même route | Document déclaré **obsolète** | entête de `authentication-folder-migration.md` |

**31 sur 31 résolues.**

---

## 6. Trous comblés

Le corpus n'avait **aucune** valeur pour ces éléments. Vérifié par `grep`.

| Trou | Valeur retenue | Référence |
|---|---|---|
| Paramètres Argon2id | m=19456, t=2, p=1, hashLength=32, sel 16 o | [ADR-0007](adr/0007-password-hashing-argon2id.md) |
| Pepper | **inexistant dans le corpus** — ajouté via l'option native `secret` | [ADR-0007](adr/0007-password-hashing-argon2id.md) |
| Longueur de mot de passe | min 12, max 128, aucune règle de composition | [ADR-0007](adr/0007-password-hashing-argon2id.md) |
| Algorithme JWT | **EdDSA Ed25519**, `kid`, rotation | [ADR-0005](adr/0005-token-signing-eddsa.md) |
| `iss` / `aud` | `https://api.eventini.com` / `eventini-web`, `eventini-scanner` | [ADR-0005](adr/0005-token-signing-eddsa.md) |
| Durées de token et de session | matrice par `clientType` + rôle | [ADR-0009](adr/0009-token-and-session-lifetimes.md) |
| TTL reset / vérification / invitation / MFA / réauth | 30 min / 24 h / 7 j / 5 min / 10 min | [ADR-0009](adr/0009-token-and-session-lifetimes.md) |
| Paramètres TOTP | SHA-1, 6, 30 s, ±1 | [`AUTHENTICATION_AUTHORIZATION.md` §1.3](security/AUTHENTICATION_AUTHORIZATION.md) |
| Recovery codes | 10 codes, 10 caractères Crockford base32 | [`AUTHENTICATION_AUTHORIZATION.md` §1.3](security/AUTHENTICATION_AUTHORIZATION.md) |
| Entropie et hachage du refresh token | 32 octets, HMAC-SHA-256 | [ADR-0014](adr/0014-refresh-token-hash-single-store.md) |
| **Toutes les limites de débit** | 11 endpoints + 4 dimensions globales | [ADR-0013](adr/0013-rate-limiting-and-lockout-baseline.md) |
| **Échelle de verrouillage** | 5→15 min, 10→1 h, 15→24 h, clé `ip+email` | [ADR-0013](adr/0013-rate-limiting-and-lockout-baseline.md) |
| Pagination | défaut 20, maximum 100 | [`API_CONVENTIONS.md` §6](api/API_CONVENTIONS.md) |
| Limites de charge utile | 100 Ko / 1 Mo / 10 Mo, 500 opérations | [`RATE_LIMITING…` §8.1](security/RATE_LIMITING_AND_ABUSE_PREVENTION.md) |
| CSP et HSTS | directives complètes | [`AUTHENTICATION_AUTHORIZATION.md` §4](security/AUTHENTICATION_AUTHORIZATION.md) |
| **Schéma de clés Redis** | catalogue complet avec TTL | [`REDIS_KEYS_AND_LUA_SCRIPTS.md` §3](infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md) |
| **Scripts Lua** | 4 scripts, écrits et **vérifiés en exécution** | [`scripts/redis/`](../scripts/redis/) |
| Rétention d'idempotence | 24 h, 7 j pour la présence | [ADR-0012](adr/0012-idempotency-storage.md) |
| Marge d'horloge | 30 s | [ADR-0009](adr/0009-token-and-session-lifetimes.md) |
| Anti-rejeu QR | 90 s | [ADR-0009](adr/0009-token-and-session-lifetimes.md) |
| Seuil de requête lente | 500 ms | [`ENVIRONMENT_VARIABLES.md`](operations/ENVIRONMENT_VARIABLES.md) |
| **Catalogue de variables d'environnement** | complet, 14 règles de validation croisée | [`ENVIRONMENT_VARIABLES.md`](operations/ENVIRONMENT_VARIABLES.md) |
| **Modèle de branches, PR, CI** | trunk-based, Conventional Commits, checks | [ADR-0017](adr/0017-delivery-model.md) |
| **Design system** | palette ajustée AA, `--brand` distinct de `--accent`, mouvement expressif, élévation teintée | [ADR-0019](adr/0019-design-system-foundation.md) · [`DESIGN_SYSTEM.md`](design/DESIGN_SYSTEM.md) |

### Domaines entiers ajoutés

`events` (table fantôme) · `event_sessions` · `participants` · `registrations` · `registration_sessions` · **tickets et format QR** · `attendance_records` · **synchronisation offline** · `idempotency_records` · `outbox_events` · architecture frontend · carte de dépendances · stratégie de migration · plan de sprints.

---

## 7. Reste ouvert

Honnêteté sur ce qui n'est **pas** décidé.

| Sujet | Statut | Débloqué par |
|---|---|---|
| Vérification de mot de passe compromis | `DEFERRED` | après M4 |
| Impersonation | `DEFERRED` | conception dédiée obligatoire |
| RLS PostgreSQL | `DEFERRED` | exigence de conformité |
| Socket.IO | `DEFERRED` | besoin réel de bidirectionnalité |
| Webhooks sortants | `DEFERRED` | demande client |
| Facturation et quotas | colonnes présentes, application reportée | décision produit |
| Hébergement, Kubernetes | non décidé | avant la mise en production |
| Sauvegarde et restauration | non décidé | avant la mise en production |
| Client Flutter | `DEFERRED` | stabilité des contrats scanner |
| Règles de points et parrainage ambassadeur | non spécifié | décision produit |

---

## 8. Maintenance

| Règle | |
|---|---|
| Un changement de contrat met à jour son document **dans la même PR** | un document en retard est pire qu'absent : il induit en erreur |
| Une décision structurante produit un ADR **avant** le code | |
| Un ADR accepté n'est jamais modifié | il est supersédé par un nouvel ADR |
| Une contradiction nouvelle est ajoutée au §5 avec sa résolution | |
| Une valeur codée en dur qui contredit un document est un **bug** | pas une variante |
| Les documents baseline (A, B, C, D) ne sont **pas réécrits** | leur entête signale ce qui est supersédé |

---

## 9. État du dépôt en une ligne

> Au 30 juillet 2026, Eventini est un **squelette d'architecture** : **zéro route HTTP atteignable**, **aucun `schema.prisma`**, 45 barrels vides et 13 fichiers de 0 octet côté backend ; 63 composants UI réels mais **zéro feature** et 7 imports cassés côté frontend ; un `docker-compose` fonctionnel et **aucun Dockerfile**. La documentation décrit désormais une cible complète, chiffrée et sans contradiction — mais **rien n'est implémenté**. Ne jamais confondre une architecture préparée avec une fonctionnalité terminée.

> 🔴 **Blocage ouvert le plus important** : `web/.git` est un dépôt git imbriqué distinct et `master` n'a aucun commit. Tant que ce n'est pas corrigé (ticket EVT-001), committer `web/` produit un lien de sous-module vide et **aucune source frontend n'est réellement versionnée**.
