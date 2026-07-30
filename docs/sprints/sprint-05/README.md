# Sprint 05 — Sécurité web

> [← Sprint 04](../sprint-04/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 06 →](../sprint-06/README.md)

| | |
|---|---|
| **Tickets** | EVT-028 → EVT-032 |
| **Prérequis** | Sprint 04 |
| **Migrations** | **13** |
| **Jalon** | — |

---

## Objectif

CSRF, rate limiting atomique, idempotence, concurrence optimiste.

Invariant **O-4** : le rate limiting précède l'exposition publique du login. Argon2id consomme 19 MiB et ~60 ms par vérification — sans limite, l'endpoint de connexion est **son propre vecteur de déni de service**.

## Critère de sortie

- `POST` sans `X-CSRF-Token` ⇒ `403` ;
- 6ᵉ login échoué ⇒ `429` ;
- **un attaquant ne peut pas verrouiller une victime** ;
- deux check-ins de même clé d'idempotence ⇒ **un seul** enregistrement.

---

## Tickets

| # | Titre | Migration |
|---|---|---|
| [EVT-028](#evt-028) | Protection CSRF avec liaison pré-session | — |
| [EVT-029](#evt-029) | Infrastructure Redis et registre Lua | — |
| [EVT-030](#evt-030) | Rate limiting et verrouillage | — |
| [EVT-031](#evt-031) | Idempotence | 13 |
| [EVT-032](#evt-032) | Concurrence optimiste | — |

---

## EVT-028 — Protection CSRF avec liaison pré-session
<a id="evt-028"></a>

```
Branche  feat/EVT-028-csrf-protection
Commit   feat(identity): add CSRF protection with pre-session token binding
Routes   GET /api/v1/auth/csrf-token
```

### Le problème résolu — contradiction C-16

Le Document B se contredisait sur le point le plus sensible du flux :

- **§44.1** classe `GET /auth/csrf` parmi les endpoints **pré-authentification** ;
- **§15.3** impose de valider, dans l'ordre : « 1. cookie d'authentification ; 2. session active ; … 7. liaison à la session » ;
- **§15.4** interdit d'exempter les mutations sensibles, sans jamais lister le login comme exempté.

Un `POST` de login n'a **ni cookie d'authentification, ni session active**. Les étapes 1, 2 et 7 ne peuvent pas passer. Tel qu'écrit, **le login était soit non protégé, soit impossible**.

Ce n'est pas théorique : sans CSRF sur le login, un attaquant réalise un **login CSRF** — il force la victime à s'authentifier sur un compte qu'il contrôle, puis observe l'activité qu'elle y produit.

### Résolution — deux modes de liaison

| Mode | Liaison | Cookie de contexte |
|---|---|---|
| **Pré-session** | identifiant de contexte anonyme | `__Host-eventini_csrf_ctx`, `HttpOnly`, 30 min |
| **Session** | `sessionId` réel | — |

**Rebinding au login** — `POST /auth/sessions` valide en mode pré-session, puis émet un **nouveau** token lié à la session créée, et supprime le cookie de contexte anonyme. Un token pré-session capturé **ne survit pas au login**.

**Référence** — [ADR-0016](../../adr/0016-pre-session-csrf-binding.md), [`AUTHENTICATION_AUTHORIZATION.md` §3](../../security/AUTHENTICATION_AUTHORIZATION.md).

### Cohérence des préfixes de cookies — contradiction C-18

Le Document B utilisait trois conventions différentes pour trois cookies du même sous-système. Le cookie CSRF lisible était le seul **sans préfixe**, alors que `__Host-` lui est applicable (il n'exige pas `HttpOnly`, seulement `Secure`, `Path=/` et l'absence de `Domain`).

| Cookie | Nom retenu |
|---|---|
| Access | `__Host-eventini_access` |
| Refresh | `__Secure-eventini_refresh`, `Path=/api/v1/auth/sessions`, `SameSite=Strict` |
| Contexte CSRF | `__Host-eventini_csrf_ctx` |
| CSRF lisible | `__Host-eventini_csrf` |

Le `Path` du refresh, **jamais nommé** dans le Document B (C-17), est fixé : le refresh token n'est pas envoyé au reste de l'API, donc une faille ailleurs ne l'expose pas.

**Tests négatifs obligatoires**

- `POST` sans header `X-CSRF-Token` ⇒ `403 AUTH_CSRF_INVALID` ;
- token CSRF valide mais lié à un **autre** contexte ⇒ `403` ;
- **token pré-session réutilisé après login ⇒ `403`** ;
- `Origin` absent ou non autorisé ⇒ `403 AUTH_ORIGIN_DENIED`.

---

## EVT-029 — Infrastructure Redis et registre Lua
<a id="evt-029"></a>

```
Branche  feat/EVT-029-redis-infrastructure
Commit   feat(infra): add Redis connections, key builder and Lua script registry
```

> ✅ **Les 4 scripts Lua sont déjà écrits et vérifiés en exécution** contre le Redis 8.8 de `docker-compose` — voir [`scripts/redis/`](../../../scripts/redis/) et [`REDIS_KEYS_AND_LUA_SCRIPTS.md` §5](../../infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md). **Ce ticket les câble**, il ne les écrit pas.

**État actuel** — `backend/src/infrastructure/redis/index.ts` contient `export {};`.

**Scope**

```
redis.module.ts              5 connexions nommées (app, bullmq×2, pub, sub)
redis.config.ts
redis-script.registry.ts     SCRIPT LOAD au démarrage, cache des SHA, repli EVAL
redis-key.builder.ts         SEULE source des clés
```

### `redis-key.builder.ts` est obligatoire

Une clé construite à la main quelque part dans un service finit par diverger d'une lettre, et le compteur qu'on croit lire n'est pas celui qu'on écrit — un bug silencieux qui désactive un contrôle de sécurité.

Le builder applique aussi le **hachage d'email** : les clés apparaissent dans `MONITOR`, `SLOWLOG` et les dumps de diagnostic. Un email en clair y est une fuite de PII. `emailHash = SHA-256(normalized_email)` tronqué à 128 bits.

**Configuration** — `maxmemory-policy = noeviction` sur la DB 0. `allkeys-lru` évincerait silencieusement un verrou ou un compteur de lockout : **une éviction ne doit jamais pouvoir désactiver un contrôle de sécurité**. La mémoire est bornée par les TTL, pas par l'éviction.

**Règle** — échec de chargement des scripts au démarrage ⇒ **`fatal`**. Sans rate limiting, l'application ne doit pas accepter de trafic.

---

## EVT-030 — Rate limiting et verrouillage
<a id="evt-030"></a>

```
Branche  feat/EVT-030-rate-limiting
Commit   feat(security): add layered rate limiting and progressive lockout
```

**Dépendance à retirer** — `@nestjs/throttler`. Installé, jamais importé, et il le restera : il ne couvre ni le multi-dimension (`ip+email` **et** `ip` **et** `organizationId` sur la même requête), ni le verrouillage progressif, ni la fenêtre glissante distribuée.

**Limites** — les 11 endpoints et 4 dimensions globales de [`RATE_LIMITING_AND_ABUSE_PREVENTION.md`](../../security/RATE_LIMITING_AND_ABUSE_PREVENTION.md).

### 🔴 La clé est `ip+email`, jamais `email` seul

C'est la décision centrale de ce ticket.

Un verrouillage sur l'email **seul** permet à un attaquant de bloquer n'importe quel utilisateur dont il connaît l'adresse, en échouant délibérément cinq fois. Le mécanisme de sécurité devient l'arme : un **déni de service contre la victime**, gratuit, à distance, indiscernable d'une vraie attaque.

Un compteur par email existe, mais il **ne verrouille jamais** : il déclenche un security event `ACCOUNT_LOCKED` à visée d'alerte. Il sert la **détection**, pas le blocage.

### Ordre d'exécution

```
requête → requestId → CORS/Origin → RATE LIMIT → CSRF
        → validation → auth → Argon2id → autorisation → traitement
```

Le rate limiting est **avant Argon2id**. Sinon 19 MiB × requêtes concurrentes font de `/auth/sessions` une cible de DoS mémoire.

### Contexte métier à ne pas oublier

Les administrateurs se connectent **depuis le lieu de l'événement**, donc derrière un NAT partagé. Une limite par IP calibrée pour un usage domestique bloquerait une équipe entière au pire moment. La clé `ip+email` isole les comptes derrière une même IP.

**Tests négatifs obligatoires**

| Test | Attendu |
|---|---|
| 6 logins échoués, même `ip+email` | `429` au 6ᵉ |
| **Attaquant échouant 10× sur l'email d'une victime** | **la victime se connecte normalement depuis sa propre IP** |
| Verrouillage actif | réponse `AUTH_INVALID_CREDENTIALS`, **jamais** `AUTH_ACCOUNT_LOCKED` |
| `X-Forwarded-For` forgé sans proxy de confiance | ignoré, IP réelle utilisée |
| Redis arrêté, route de login | `503` — **fail closed** |
| Redis arrêté, route de lecture | `200` + log `error` — fail open |
| 100 requêtes concurrentes, limite 10 | exactement 10 acceptées |

---

## EVT-031 — Idempotence
<a id="evt-031"></a>

```
Branche  feat/EVT-031-idempotency
Commit   feat(api): add PostgreSQL-backed idempotency with request fingerprinting
Tables   idempotency_records                                   (migration 13)
```

**Contradiction résolue — C-9** : le Document C §19 spécifiait l'idempotence de façon complète (12 colonnes, 5 états, empreinte canonique), et la liste des 21 tables du Document A **ne contenait aucune table d'idempotence**.

**Décision** — PostgreSQL fait foi, Redis n'est qu'un court-circuit ([ADR-0012](../../adr/0012-idempotency-storage.md)).

```sql
INSERT INTO idempotency_records (...) VALUES (...)
ON CONFLICT (organization_id, actor_id, method, route, idempotency_key)
DO NOTHING RETURNING id;
```

**Aucun verrou n'est nécessaire** — l'index unique **est** le mécanisme atomique. C'est exactement ce que le Document C §19.6 demandait en écrivant qu'« un simple `find then insert` est vulnérable » : ici il n'y a pas de `find` avant l'`insert`.

**Empreinte canonique** — SHA-256 de `method` + gabarit de route + `organizationId` + `actorId` + JSON canonicalisé + params. Les en-têtes volatils (`traceparent`, `User-Agent`, `X-Request-Id`) sont **exclus** : les inclure ferait diverger l'empreinte à chaque réessai, transformant un rejeu légitime en `409`.

**Requête en vol : `409 + Retry-After: 2`**, pas d'attente. Un client bloqué retient une connexion serveur ; sous synchronisation offline, cela épuise le pool bien avant tout le reste. Le `409` déplace l'attente côté client, où elle est gratuite.

**Rétention** — 24 h en nominal, **7 jours** pour la synchronisation attendance : un scanner peut rester déconnecté toute la durée d'un événement multi-jours.

**Tests obligatoires**

- même clé + corps différent ⇒ `409 IDEMPOTENCY_CONFLICT` ;
- même clé, **deux organisations** ⇒ deux exécutions distinctes ;
- corps réordonné (`{"a":1,"b":2}` vs `{"b":2,"a":1}`) ⇒ même empreinte ;
- `traceparent` différent ⇒ même empreinte ;
- **`FLUSHALL` Redis puis rejeu ⇒ aucun doublon**.

Le dernier test prouve que le choix de stockage était le bon : une idempotence Redis-only y produirait un double enregistrement.

---

## EVT-032 — Concurrence optimiste
<a id="evt-032"></a>

```
Branche  feat/EVT-032-optimistic-concurrency
Commit   feat(api): add optimistic concurrency with ETag and If-Match
```

```sql
UPDATE events SET name = $1, version = version + 1
WHERE id = $2 AND organization_id = $3 AND version = $4;
-- 0 ligne affectée ⇒ 409 VERSION_CONFLICT
```

Le filtre `organization_id` est présent **même avec un `id` de clé primaire** : c'est la règle de la garde Prisma, sans exception pour les lectures par identifiant.

**Obligatoire sur** — `events`, `event_sessions`, `participants`, `registrations`, `organizations`, `organization_memberships`.

`If-Match` absent ⇒ **`428 PRECONDITION_REQUIRED`**. Délibérément strict : sur un événement édité simultanément par deux administrateurs, une écriture aveugle écrase silencieusement le travail de l'autre.

**Tests** — sans `If-Match` ⇒ `428` · `If-Match` périmé ⇒ `412` · deux `PATCH` concurrents ⇒ un `409`.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| CSRF exempté sur le login « parce que c'est compliqué » | ADR-0016 ; test de login CSRF obligatoire |
| Lockout implémenté sur `email` seul par réflexe | Test explicite : la victime doit pouvoir se connecter |
| Rate limiting placé après Argon2id | Ordre documenté ; test de charge sur `/auth/sessions` |
| `@nestjs/throttler` utilisé pour aller vite | Ne couvre pas le multi-dimension ; à retirer dans ce sprint |
| Idempotence mise en Redis pour la performance | Test `FLUSHALL` bloquant |
| Clés Redis construites à la main hors du builder | Revue + le builder est la seule source |
