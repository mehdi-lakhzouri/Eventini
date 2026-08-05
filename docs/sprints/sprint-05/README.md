# Sprint 05 — Sécurité web

> [← Sprint 04](../sprint-04/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 06 →](../sprint-06/README.md)

| | |
|---|---|
| **Tickets** | EVT-028 → EVT-031 · EVT-032 **reporté au sprint 08** |
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
| [EVT-028](#evt-028) | Protection CSRF avec liaison pré-session | — · ✅ |
| [EVT-029](#evt-029) | Infrastructure Redis et registre Lua | — · ✅ |
| [EVT-030](#evt-030) | Rate limiting et verrouillage | — · ✅ |
| [EVT-031](#evt-031) | Idempotence | 13 |
| [EVT-032](#evt-032) | Concurrence optimiste | — · ⏭ **reporté au sprint 08** |

---

## EVT-028 — Protection CSRF avec liaison pré-session
<a id="evt-028"></a>

> ✅ **Fait le 5 août 2026.** Garde globale, 52 tests unitaires, 12 tests e2e contre PostgreSQL réel. La suite e2e complète passe : 13 suites, 134 tests.

### Ce que la liaison résout, prouvé par un test

Le rejeu d'un token pré-session après login est **le** test de ce ticket : `refuses the pre-session token once it has been spent on a login`. Sans lui, le mode pré-session serait un moyen d'armer à l'avance un token pour une victime authentifiée — exactement l'inverse du but.

| Test obligatoire | Résultat |
|---|---|
| `POST` sans `X-CSRF-Token` | `403 AUTH_CSRF_INVALID` |
| Token lié à un **autre** contexte | `403 AUTH_CSRF_INVALID` |
| **Token pré-session rejoué après login** | **`403`** |
| `Origin` absent ou refusé | `403 AUTH_ORIGIN_DENIED` |

### 🔴 L'ordre garde-avant-authentification a un coût qu'il faut assumer

`CsrfGuard` s'exécute **avant** l'authentification. Une requête sans token *et* sans session répond donc `403`, pas `401`. Trois tests existants demandaient `401` et avaient raison de le faire à l'époque : ils testaient l'authentification.

Ils ont été corrigés en **fournissant un couple CSRF valide**, pour que le `401` porte bien sur la session manquante et non sur la garde qui la précède. Un test supplémentaire couvre désormais l'autre moitié : sans token, c'est `403`, *avant* que la session soit seulement regardée. Changer l'assertion sans fournir le token aurait transformé un test d'authentification en test de CSRF sans que personne le remarque.

### La porte MFA et le CSRF : deux chemins, deux décisions

`POST /auth/sessions` peut désormais se terminer de deux façons, et elles n'appellent pas le même traitement.

| Issue du login | Rebinding CSRF | Pourquoi |
|---|---|---|
| Session créée | **oui** | le token qui a passé la garde ne vérifie plus rien ensuite |
| `AUTH_MFA_REQUIRED` | **non** | il n'y a **aucune session** à laquelle lier, et le client a encore une seconde étape à poster |

Rebinder sur la branche MFA aurait détruit le token nécessaire à la vérification du challenge ; le lier au `challengeId` l'aurait lié à quelque chose qui n'authentifie personne. Le rebinding appartient donc à `MfaChallengeController`, qui est l'endroit où la session naît réellement.

### Le préfixe de cookie qui piège

`__Host-eventini_csrf` est un **préfixe de** `__Host-eventini_csrf_ctx`. Un test qui cherchait le cookie lisible par `startsWith(nom)` trouvait le cookie de contexte et concluait, à tort, que le token était `HttpOnly`. La correspondance se fait sur `nom=`. C'est le genre de défaut qui rend vert un test qui ne teste rien.

### Ce que la garde globale a coûté aux suites existantes

Six suites e2e écrivaient des mutations sans token et échouaient toutes. C'est le prix réel d'une garde globale, et il valait mieux le payer que d'exempter des routes : un helper partagé (`test/helpers`) fait la poignée de main pré-session et fusionne le couple CSRF avec les cookies de session, **construit à partir des `Set-Cookie` du serveur** — un test qui fabriquerait son propre token continuerait de passer après la rupture de la liaison.

### Structure livrée

```
csrf/domain/            csrf-token.ts (HMAC + comparaison à temps constant) · csrf-context.ts
csrf/infrastructure/    csrf-cookies.ts
csrf/                   csrf.service.ts · csrf.guard.ts (APP_GUARD) · csrf.controller.ts
                        csrf-token.service.ts · origin-validator.service.ts
```

La route est `GET /api/v1/auth/csrf-token` — le contrôleur portait encore `identity/csrf`, un chemin d'une convention abandonnée, corrigé ici pour suivre `API_CONVENTIONS.md`.

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

> ✅ **Fait le 5 août 2026.** 68 tests unitaires, 4 tests d'intégration contre le Redis 8.8 réel de `docker-compose`. Comme annoncé, ce ticket **câble** les 4 scripts Lua, il ne les réécrit pas.

### `redis-key.builder.ts` est la seule source de clés, et le hachage y est forcé

Le builder ne se contente pas de centraliser : il rend la faute **impossible plutôt que déconseillée**. Le hachage d'email vit dans les primitives (`redis-key.segments.ts`), donc aucun appelant ne peut placer une adresse en clair dans une clé en oubliant une étape.

Deux détails qui valaient d'être écrits :

- **La normalisation est faite dans le hachage**, pas au point d'appel. Sans cela `A@x.com` et `a@x.com` sont deux compteurs, et un attaquant échappe à une limite par email en changeant la casse.
- **Le segment IP est injectif.** IPv6 s'écrit avec des `:`, qui est le séparateur de clés ; ils deviennent des `-`, et aucune IP textuelle ne contient de `-`. Deux adresses distinctes ne peuvent donc pas retomber sur le même compteur — ce qui reviendrait à limiter deux clients comme s'ils n'en étaient qu'un. La forme `::ffff:a.b.c.d` est ramenée à sa forme v4, sinon le même client compte sous deux clés selon la façon dont le socket est lié.

### Échec de chargement au démarrage ⇒ fatal

`RedisScriptRegistry.onModuleInit` lève, ce qui interrompt `NestFactory.create` et tombe dans le `exitFatal` de `main.ts`. Démarrer sans ces scripts, c'est servir `/auth/sessions` **sans aucun rate limiting** — précisément la condition que l'invariant O-4 existe pour empêcher.

En fonctionnement, `NOSCRIPT` après un `SCRIPT FLUSH` est rattrapé : le script est rechargé et l'appel en cours rejoué en ligne, donc l'appelant ne voit jamais le manque. Le test d'intégration provoque un vrai flush pour vérifier que Redis se comporte comme le fake du test unitaire le suppose.

### 🟡 `maxmemory-policy` : signalé, pas fatal — et c'est délibéré

Sous `allkeys-lru`, Redis choisit ses victimes par ancienneté d'accès, ce qui **sélectionne presque parfaitement les mauvaises clés** : un compteur de lockout est écrit une fois et lu rarement, un verrou distribué est écrit une fois et jamais relu. Ce sont les premières choses qu'un LRU jette, et les jeter désactive silencieusement le contrôle. La mémoire est bornée par les TTL, pas par l'éviction.

Le contrôle lit la politique au démarrage mais **ne fait pas échouer le boot** si elle est mauvaise, parce que le §8 demande que `CONFIG` soit renommée ou désactivée en production : un serveur durci refuse cette lecture. Un démarrage qui n'échouerait que sur les serveurs où le contrôle fonctionne serait pire qu'un log bruyant. `UNKNOWN` est donc une réponse normale, pas une erreur.

`docker-compose.yml` fixe la politique explicitement, bien qu'elle soit déjà le défaut de Redis — un défaut sur lequel on s'appuie mérite d'être écrit.

### Structure livrée

```
infrastructure/redis/
├── redis-key.builder.ts        le catalogue complet des clés
├── redis-key.segments.ts       hachage d'email, segment IP, segment d'identifiant
├── redis-script.registry.ts    SCRIPT LOAD au boot, cache des SHA, repli NOSCRIPT
├── redis-connection.factory.ts
├── redis.module.ts             les connexions nommées
├── eviction-policy.check.ts
└── lua-scripts.ts
```

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

> ✅ **Fait le 5 août 2026.** 33 tests unitaires, 6 tests e2e contre PostgreSQL et Redis réels. `@nestjs/throttler` est **retiré** de `package.json`.

### 🔴 `ip+email`, et le test qui le prouve

Le test qui compte n'est pas « la 6ᵉ tentative reçoit un 429 » — c'est celui qui vérifie que **la victime garde son accès** :

```
1. l'attaquant échoue 10 fois contre l'adresse de la victime, depuis son IP
2. l'attaquant est bien bloqué                        → 429
3. la victime se connecte depuis sa propre IP         → 201
```

Les **deux** assertions sont nécessaires. Sans la deuxième, un limiteur qui ne ferait rien du tout laisserait aussi passer la victime et le test serait vert pour la mauvaise raison. Sans la première, on ne saurait pas que le mécanisme s'est déclenché.

Le compteur par email existe et **ne verrouille jamais** : il est incrémenté à chaque échec pour la détection, sans effet de blocage. Détection et blocage sont deux mécanismes séparés ici, délibérément.

### Le verrouillage est consulté **avant** Argon2id

Une paire verrouillée ne doit pas pouvoir dépenser 19 MiB et ~60 ms de serveur par tentative. Le contrôle est donc placé avant même la recherche du compte — un test l'exige en vérifiant qu'**aucune requête base de données n'a lieu** quand la paire est verrouillée.

Ce que le client voit d'un verrouillage : `401 AUTH_INVALID_CREDENTIALS`, exactement comme un mot de passe faux. `AUTH_ACCOUNT_LOCKED` reste absent du catalogue. L'annoncer confirmerait l'existence du compte **et** signalerait à l'attaquant que son déni de service a fonctionné.

### L'échec sur un compte inexistant compte aussi

Sinon la présence ou l'absence d'un verrouillage répondrait à « cette adresse existe-t-elle ? » — précisément la question à laquelle l'étape 7 dépense un hachage factice pour ne pas répondre.

### L'ordre des gardes est le contrôle

`RateLimitGuard` est enregistré **avant** `CsrfGuard`, en plaçant `RateLimitingModule` avant `IdentityModule` dans `AppModule` : Nest exécute les `APP_GUARD` dans l'ordre d'enregistrement. C'est l'invariant O-4 — un endpoint de login qui hache d'abord et compte ensuite est son propre vecteur de déni de service mémoire.

### La couche la plus restrictive gagne, et le `Retry-After` le plus long avec elle

Parmi les refus, c'est la **plus longue** attente qui est retournée. Retourner la plus courte ferait revenir un client respectueux du `Retry-After` juste à temps pour être refusé par une couche plus lente qu'il avait aussi dépassée.

Le `429` ne nomme **jamais** la dimension dépassée, et un test vérifie que le corps ne contient ni `email`, ni `ip`, ni l'adresse essayée.

### 🔴 Une fenêtre ne doit jamais dépendre de ce que l'appelant envoie

CodeQL a signalé deux `js/user-controlled-bypass` de sévérité haute, et il avait raison. La fenêtre par email n'était ajoutée que `if (facts.email !== null)` — or **cette garde s'exécute avant le pipe de validation**, donc `email` est ce qui est arrivé sur le fil : un nombre, un tableau, ou rien. Un appelant pouvait donc **supprimer sa propre limite** en malformant le champ.

La fenêtre est maintenant inconditionnelle : une adresse inutilisable tombe dans un seau commun. Ces tentatives ne peuvent de toute façon pas s'authentifier, et les regrouper les **compte** au lieu de les laisser passer sans compteur. Même correction pour le reset de mot de passe, et l'identifiant de challenge MFA est désormais extrait du chemin plutôt que testé, donc aucune valeur fournie par l'appelant ne garde une action sensible.

### 🟡 Ce que le limiteur a coûté à la suite e2e, et pourquoi c'est correct

Six suites e2e se sont mises à échouer : elles se connectent des dizaines de fois, toutes depuis `127.0.0.1`, et épuisaient donc légitimement la fenêtre de login par IP. **Du point de vue du limiteur, la suite entière est un seul client très insistant** — c'est le limiteur qui fonctionne, pas un défaut.

La correction est l'isolation, pas une limite plus lâche :

- un helper `resetRateLimits()` efface `rl:*` et `lockout:*` entre les tests — pas un `FLUSHDB`, qui emporterait les challenges MFA et les contextes CSRF d'autres suites ;
- la suite e2e passe en **`maxWorkers: 1`**. Les lignes PostgreSQL se partitionnent par suffixe unique ; les compteurs de rate limiting sont indexés par IP et ne se partitionnent pas. Des suites parallèles se supprimaient mutuellement leurs compteurs en plein test.

### Structure livrée

```
rate-limiting/domain/       rate-limit.policy.ts (les 11 endpoints + 4 dimensions)
                            rate-limit.decision.ts · retry-after.ts · client-ip.ts
rate-limiting/infrastructure/  sliding-window.limiter.ts · lockout.store.ts
rate-limiting/              rate-limit.guard.ts (APP_GUARD)
```

`client-ip.ts` lit `req.ip` et **jamais** `X-Forwarded-For` directement : Express applique déjà `trust proxy` avec un nombre de sauts explicite. Lire l'en-tête à cette couche annulerait ce réglage, et n'importe qui contournerait toute limite par IP en le forgeant — le §7.6 en fait l'erreur la plus courante des implémentations de rate limiting.

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

> ⏭ **Reporté au [sprint 08](../sprint-08/README.md#evt-032), le 5 août 2026. Aucune ligne n'en a été écrite.**
>
> **La raison : ce ticket n'a rien à garder.** L'audit du dépôt au moment d'attaquer le sprint donne :
>
> | Ressource visée par « Obligatoire sur » | État réel |
> |---|---|
> | `events`, `event_sessions` | table et colonne `version` présentes, **aucun contrôleur** |
> | `organizations`, `organization_memberships` | table et colonne `version` présentes, **aucun contrôleur** |
> | `participants`, `registrations` | **la table n'existe pas** (sprint 10) |
>
> Les seuls contrôleurs du dépôt sont ceux de l'authentification. Il n'existe donc **aucune route de mutation** sur laquelle poser `If-Match`, et par conséquent aucun test e2e capable de prouver que le mécanisme fonctionne. Livrer l'intercepteur ici, c'était livrer du code que rien n'appelle et que rien ne vérifie — la définition d'un contrôle de sécurité qu'on croit avoir.
>
> Le sprint 08 amène **EVT-042 — CRUD organisation contrôlé**, donc `PATCH /organizations/{id}` : le premier vrai consommateur. `If-Match` y arrive avec une route à protéger et un test de conflit réel à écrire.
>
> Ce qui rendait le report sûr : les colonnes `version` **existent déjà** sur les quatre tables concernées. Le report ne coûte aucune migration et ne bloque rien.


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
| Un mécanisme livré sans route qui le consomme | EVT-032 reporté au sprint 08 plutôt que livré à vide |
