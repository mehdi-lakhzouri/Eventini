# Eventini — Clés Redis et scripts Lua

> **Statut :** Spécification normative · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Décision :** [ADR-0011](../adr/0011-redis-lua-atomic-operations.md) · **Scripts :** [`scripts/redis/`](../../scripts/redis/)
> **Redis :** 8.8 (`docker/docker-compose.yml`, port hôte 6380, `--requirepass`, `--appendonly yes`)

> ⚠️ **Le corpus ne contenait aucun schéma de clés, aucun TTL, aucune mention de Lua** — vérifié par `grep`. Ce document comble intégralement ce trou. Aucun code Redis n'existe dans `backend/src` : `src/infrastructure/redis/index.ts` contient `export {};`.

---

## 1. Ce que Redis a le droit d'être

Redis est un **magasin d'état temporaire**. Jamais la source de vérité métier.

| Autorisé | Interdit comme source unique |
|---|---|
| Rate limiting, lockout | Sessions |
| Cache de session et de permissions | Memberships, rôles, permissions |
| Challenges MFA | État des refresh tokens |
| Nonces anti-rejeu | Organisations, événements |
| Court-circuit d'idempotence | Enregistrements d'idempotence |
| Files BullMQ | Audit, security events |
| Verrous courts | Présence de check-in |
| Déduplication | |

**Test de conformité** : `FLUSHALL` en production doit provoquer une dégradation de performance et une re-authentification, **jamais** une perte de donnée métier ni un double check-in. Si ce n'est pas vrai, un usage de Redis est mal placé.

---

## 2. Connexions

Cinq connexions séparées (Document B §38) — BullMQ met ses connexions en mode bloquant, ce qui rendrait une connexion partagée inutilisable pour le reste.

| Connexion | Usage | DB |
|---|---|---|
| `app` | cache, rate limit, lockout, nonces, verrous | 0 |
| `bullmq-producer` | mise en file | 1 |
| `bullmq-worker` | consommation (bloquante) | 1 |
| `pubsub-publisher` | diffusion temps réel | 2 |
| `pubsub-subscriber` | abonnement (bloquant) | 2 |

Configuration : `maxmemory-policy = noeviction` sur la DB 0. `allkeys-lru` évincerait silencieusement un verrou ou un compteur de lockout — une éviction ne doit jamais pouvoir désactiver un contrôle de sécurité. Toutes les clés portent un TTL explicite ; la mémoire est bornée par les TTL, pas par l'éviction.

---

## 3. Catalogue des clés

**Convention** : `{domaine}:{sous-domaine}:{discriminant}` — minuscules, `:` comme séparateur, jamais d'espace ni de caractère accentué.

**Règle absolue** : aucune donnée personnelle en clair dans une clé. Les clés apparaissent dans `MONITOR`, `SLOWLOG`, `--bigkeys` et les dumps de diagnostic. Un email en clair y est une fuite de PII.

```
emailHash = SHA-256(normalized_email) tronqué à 128 bits, en hexadécimal
```

### 3.1 Rate limiting

| Clé | Type | TTL | Contenu |
|---|---|---|---|
| `rl:global_ip:{ip}` | ZSET | 60 s | fenêtre glissante |
| `rl:global_user:{userId}` | ZSET | 60 s | |
| `rl:global_org:{organizationId}` | ZSET | 60 s | |
| `rl:login_ip_email:{ip}:{emailHash}` | ZSET | 900 s | |
| `rl:login_ip:{ip}` | ZSET | 900 s | |
| `rl:mfa_verify:{challengeId}` | ZSET | 300 s | |
| `rl:refresh:{sessionId}` | ZSET | 3600 s | |
| `rl:pwd_reset_email:{emailHash}` | ZSET | 3600 s | |
| `rl:pwd_reset_ip:{ip}` | ZSET | 3600 s | |
| `rl:checkin_device:{deviceId}` | ZSET | 60 s | |
| `rl:import_org:{organizationId}` | ZSET | 3600 s | |

### 3.2 Lockout

| Clé | Type | TTL | Contenu |
|---|---|---|---|
| `lockout:{ip}:{emailHash}` | STRING | 900 s | compteur d'échecs consécutifs |
| `lockout:lock:{ip}:{emailHash}` | STRING | palier | horodatage de fin de verrou |
| `lockout:counter:{emailHash}` | STRING | 3600 s | **détection seule**, ne verrouille jamais |

En Cluster, les deux premières clés doivent tomber dans le même slot. Les callers les construisent avec un tag de hachage : `lockout:{ip:emailHash}` et `lockout:lock:{ip:emailHash}`.

### 3.3 Cache

| Clé | Type | TTL | Contenu |
|---|---|---|---|
| `session:{sessionId}` | HASH | 300 s | miroir de `user_sessions`, jamais autoritaire |
| `perms:{membershipId}:v{n}` | SET | 300 s | permissions effectives d'organisation |
| `perms:platform:{userId}:v{n}` | SET | 60 s | permissions plateforme, TTL plus court |
| `permsver:{membershipId}` | STRING | ∞ | compteur `n`, miroir PostgreSQL |
| `org:{organizationId}:status` | STRING | 60 s | statut + `is_enabled` |
| `event:{eventId}:state` | HASH | 30 s | statut + fenêtres de check-in |

**Invalidation par version, pas par suppression.** Incrémenter `permsver` rend toutes les clés de l'ancienne version inatteignables, d'un coup, sans parcourir de clés et sans fenêtre d'incohérence. Une suppression par motif exigerait `SCAN`, serait partielle sous charge, et laisserait passer des permissions révoquées.

### 3.4 Sécurité et anti-rejeu

| Clé | Type | TTL | Contenu |
|---|---|---|---|
| `replay:qr:{publicReference}:{nonce}` | STRING | 90 s | revendication anti-rejeu |
| `mfa:challenge:{challengeId}` | HASH | 300 s | `userId`, tentatives, `clientType` |
| `reauth:{sessionId}` | STRING | 600 s | preuve de réauthentification |
| `csrf:ctx:{contextId}` | STRING | 1800 s | contexte CSRF pré-session |
| `revoked:session:{sessionId}` | STRING | = durée access | révocation immédiate |

`revoked:session:*` sert à couper un access token **avant** son expiration naturelle sans lecture PostgreSQL sur chaque requête. C'est une optimisation, pas la source de vérité : `user_sessions.status` reste autoritaire.

### 3.5 Idempotence et verrous

| Clé | Type | TTL | Contenu |
|---|---|---|---|
| `idem:{organizationId}:{actorId}:{routeHash}:{key}` | STRING | 300 s | court-circuit — **PostgreSQL fait foi** ([ADR-0012](../adr/0012-idempotency-storage.md)) |
| `lock:import:{organizationId}` | STRING | 900 s | verrou consultatif |
| `lock:export:{organizationId}` | STRING | 900 s | |
| `lock:outbox:publisher` | STRING | 30 s | un publieur actif à la fois |

### 3.6 Temps réel

| Clé | Type | TTL | Contenu |
|---|---|---|---|
| `presence:event:{eventId}:devices` | ZSET | 300 s | appareils actifs, score = dernier contact |
| `presence:event:{eventId}:counters` | HASH | 60 s | compteurs affichés au tableau de bord |
| `sse:conn:{userId}` | STRING | 3600 s | nombre de connexions SSE |
| `pubsub:event:{eventId}` | canal | — | diffusion inter-instances |

---

## 4. Les quatre scripts Lua

### 4.1 Discipline

| Règle | Motif |
|---|---|
| Les clés arrivent **uniquement** par `KEYS` | compatibilité Redis Cluster ; une clé construite dans le script casse le routage de slot |
| Aucune commande non déterministe (`TIME`, `RANDOMKEY`, `SRANDMEMBER`) | réplication et AOF sûres |
| `now_ms` fourni par l'appelant | une seule horloge de référence — l'application — plutôt que celle de chaque nœud Redis |
| Court, sans boucle non bornée | un script bloque **tout** le serveur Redis pendant son exécution |
| Chargés par `SCRIPT LOAD` au démarrage, appelés en `EVALSHA` | évite de transmettre le corps du script à chaque appel |
| Repli `EVAL` sur erreur `NOSCRIPT` | survit à un redémarrage de Redis ou à un `SCRIPT FLUSH` |
| Version dans l'entête ; **une modification incompatible crée un nouveau fichier** | un `EVALSHA` en vol pendant un déploiement ne doit jamais changer de sémantique |

### 4.2 `rate-limit-sliding-window.lua`

```
KEYS[1]  clé de fenêtre
ARGV[1]  limite      ARGV[2]  fenêtre ms
ARGV[3]  maintenant ms   ARGV[4]  identifiant unique de la requête
RETURN   { autorisé, restant, retry_after_secondes }
```

Fenêtre glissante par ZSET plutôt que fenêtre fixe : une fenêtre fixe autorise jusqu'au double de la limite à cheval sur deux fenêtres. Sur un endpoint de login, cet écart compte.

`retry_after` est dérivé de l'entrée la plus ancienne encore dans la fenêtre — c'est le moment où un créneau se libère réellement, pas une estimation.

### 4.3 `lockout-register-failure.lua`

```
KEYS[1]  compteur    KEYS[2]  verrou
ARGV[1]  maintenant ms   ARGV[2]  TTL du compteur ms
ARGV[3]  paliers "5,10,15"   ARGV[4]  durées ms "900000,3600000,86400000"
RETURN   { verrouillé, verrouillé_jusqu_ms, tentatives }
```

L'échelle est parcourue **du haut vers le bas** : le palier le plus élevé atteint l'emporte.

Un verrou déjà actif **n'est jamais prolongé** par de nouvelles tentatives. Sans cette règle, un attaquant maintiendrait indéfiniment un verrou en continuant à frapper.

La clé doit être `ip+email`, jamais `email` seul — [ADR-0013 §5.2](../adr/0013-rate-limiting-and-lockout-baseline.md).

### 4.4 `anti-replay-claim.lua`

```
KEYS[1]  clé de nonce
ARGV[1]  TTL ms    ARGV[2]  revendiquant    ARGV[3]  maintenant ms
RETURN   { revendiqué, revendiquant_initial, revendiqué_à_ms }
```

`SET NX PX` suffirait pour la revendication seule. Le script existe pour que la revendication **et** la trace du revendiquant soient atomiques : sur un rejeu, l'appelant a besoin du premier revendiquant pour produire un motif de refus exploitable plutôt qu'un `409` opaque.

Si la clé expire entre le `SET NX` et le `GET`, le script renvoie « rejeu ». Échouer en refusant est le comportement correct pour un contrôle anti-rejeu.

### 4.5 `distributed-lock.lua`

```
KEYS[1]  clé de verrou
ARGV[1]  'acquire' | 'release' | 'extend'
ARGV[2]  jeton de propriétaire    ARGV[3]  TTL ms
RETURN   { succès, ttl_ou_restant }
```

**C'est le script qui justifie le plus l'usage de Lua.** Un `DEL` naïf libère ce qui se trouve là — y compris un verrou acquis par une **autre** instance après l'expiration du nôtre. La comparaison du propriétaire et la suppression doivent être un seul pas atomique.

Réentrant : le même propriétaire qui ré-acquiert rafraîchit son propre verrou au lieu de se bloquer lui-même.

**Ce verrou est consultatif.** Il ne remplace **jamais** une contrainte PostgreSQL. La rotation de refresh token est sérialisée par `ux_refresh_active_per_family`, l'idempotence par `ux_idempotency_scope`. Ce verrou sert à la coordination (un seul worker par lot d'import), pas à la correction.

---

## 5. Vérification exécutée

Les quatre scripts ont été **réellement exécutés** contre le Redis 8.8 de `docker/docker-compose.yml` le 30 juillet 2026. Sortie brute :

```
=== 1. RATE LIMIT (limit=3, window=60s) ===
  call 1 -> 1 2 0            autorisé, 2 restants
  call 2 -> 1 1 0
  call 3 -> 1 0 0            dernier créneau
  call 4 -> 0 0 60           REJETÉ, retry après 60 s
  TTL set: 59990ms           la clé ne survit pas à la fenêtre
  window slid (now+70s) -> 1 2 0   la fenêtre a bien glissé

=== 2. LOCKOUT (paliers 3,5 -> 15 min, 1 h) ===
  failure 1 -> 0 0 1
  failure 2 -> 0 0 2
  failure 3 -> 1 1785269700000 3    VERROUILLÉ = now + 900000 ms
  failure 4 -> 1 1785269700000 3    verrou NON prolongé

=== 3. ANTI-REPLAY ===
  first claim -> 1  0
  replay      -> 0 dev_01 1785268800000   refus + revendiquant initial

=== 4. DISTRIBUTED LOCK ===
  acquire A -> 1 30000
  acquire B -> 0 29994       B voit le temps restant
  release B -> 0 0           B NE PEUT PAS libérer le verrou de A
  still held by: ownerA
  extend A  -> 1 60000
  release A -> 1 0
  key gone (0 expected): 0

=== 5. SCRIPT LOAD ===
  rate-limit-sliding-window -> 38abb0c442b59ac876dbe142042ef98a19cd2f71
  lockout-register-failure  -> 0cfcd63879ddf129b32877bc41bb721d1da0560f
  anti-replay-claim         -> 342ea19491e0c161854c770ab0b20f6e663ce94d
  distributed-lock          -> cddd3d205801c9bf746e971e2fa76bc5629f8bb6
```

Les quatre comportements critiques sont prouvés : la limite est exacte au créneau près, le verrou n'est pas prolongeable par un attaquant, un rejeu est détecté avec son revendiquant initial, et **une instance ne peut pas libérer le verrou d'une autre**.

Reproduire :

```bash
docker cp scripts/redis/. eventini-redis:/scripts/
docker exec eventini-redis redis-cli -a "$REDIS_PASSWORD" --no-auth-warning \
  --eval /scripts/rate-limit-sliding-window.lua rl:test , 3 60000 1785268800001 m1
```

---

## 6. Intégration NestJS

```
backend/src/infrastructure/redis/
├── redis.module.ts              5 connexions nommées
├── redis.config.ts              URL, mot de passe, TLS, pool
├── redis-script.registry.ts     SCRIPT LOAD au démarrage, cache des SHA
├── redis-key.builder.ts         SEULE source des clés — jamais de concaténation ad hoc
├── rate-limiter.service.ts
├── lockout.service.ts
├── anti-replay.service.ts
├── distributed-lock.service.ts
└── redis-health.indicator.ts
```

**`redis-key.builder.ts` est obligatoire.** Une clé construite à la main quelque part dans un service finit par diverger d'une lettre, et le compteur qu'on croit lire n'est pas celui qu'on écrit. Le builder applique aussi le hachage d'email — impossible à oublier.

`redis-script.registry.ts` charge les quatre scripts au démarrage, mémorise les SHA, et retente en `EVAL` sur `NOSCRIPT`. Un échec de chargement au démarrage est **`fatal`** : sans rate limiting, l'application ne doit pas accepter de trafic.

---

## 7. Repli et santé

| Contexte | Redis indisponible |
|---|---|
| Rate limiting sur l'authentification | **fail closed** — `503 DEPENDENCY_UNAVAILABLE` |
| Rate limiting ailleurs | fail open + log `error` + `redis_fallback_total` |
| Cache de session | lecture PostgreSQL, log `warn`, `SESSION_CACHE_MISS` |
| Cache de permissions | lecture PostgreSQL, log `warn` |
| Anti-rejeu QR | **fail closed** — le refus est le comportement sûr |
| Verrou distribué | fail closed sur les opérations concernées |
| Court-circuit d'idempotence | fail open — PostgreSQL fait foi de toute façon |
| BullMQ | jobs indisponibles, `readiness` en échec |

`/health/ready` échoue si Redis est absent. `/health/live` reste vert : le processus répond, il est simplement dégradé. Confondre les deux ferait redémarrer en boucle un service qui n'a pas de problème.

---

## 8. Sécurité opérationnelle

| Contrôle | Règle |
|---|---|
| Authentification | `requirepass` obligatoire — déjà en place dans `docker-compose.yml` |
| Réseau | jamais exposé publiquement ; réseau privé uniquement |
| TLS | requis dès que Redis quitte l'hôte de l'application |
| `MONITOR` | interdit en production — expose toutes les clés et valeurs |
| Commandes dangereuses | `FLUSHALL`, `FLUSHDB`, `KEYS`, `CONFIG` renommées ou désactivées |
| `KEYS` dans le code | interdit — `SCAN` uniquement, et seulement en administration |
| PII | jamais en clair dans une clé ni dans une valeur |
| Secrets | jamais stockés dans Redis |
| Persistance | `appendonly yes` — déjà en place ; utile pour les files, pas une garantie métier |
| Sauvegarde | **aucune sauvegarde Redis n'est nécessaire** : rien d'irremplaçable n'y réside. C'est la conséquence directe du §1 |

---

## 9. Tests obligatoires

| # | Test | Attendu |
|---|---|---|
| 1 | Limite exacte | la N-ième requête passe |
| 2 | Limite + 1 | rejet avec `retry_after` ≥ 1 |
| 3 | Fenêtre expirée | de nouveau autorisé |
| 4 | 100 appels concurrents, limite 10 | exactement 10 autorisés |
| 5 | Palier de lockout franchi | verrou posé, durée conforme |
| 6 | Tentative pendant un verrou | verrou **non** prolongé |
| 7 | Deuxième revendication de nonce | refus + revendiquant initial |
| 8 | Libération de verrou par un non-propriétaire | échec, verrou intact |
| 9 | Ré-acquisition par le propriétaire | succès, TTL rafraîchi |
| 10 | Expiration de verrou | acquisition possible par un autre |
| 11 | TTL posé sur toute clé écrite | aucune clé sans TTL |
| 12 | `SCRIPT FLUSH` puis appel | repli `EVAL`, aucune erreur remontée |
| 13 | Redis arrêté, route de login | `503` |
| 14 | Redis arrêté, route de lecture | `200` + log `error` |
| 15 | `FLUSHALL` puis rejeu d'un check-in | **aucun doublon** — PostgreSQL a tenu |

Le test 15 est le test de conformité du §1 : il prouve que Redis n'est pas devenu une source de vérité par accident.
