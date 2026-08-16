# Eventini — Catalogue des variables d'environnement

> **Statut :** Spécification normative · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Validation :** bloquante au démarrage — [`BACKEND_ARCHITECTURE.md` §9](../architecture/BACKEND_ARCHITECTURE.md)

> ✅ **Implémenté par EVT-008** (30 juillet 2026). `backend/.env.example` et `web/.env.example` existent, la validation est en place dans `backend/src/config/`, et les règles croisées du §17 sont vérifiées de bout en bout (15 depuis EVT-078).
>
> Pour un `.env` de développement complet en une commande :
>
> ```bash
> cd backend && node scripts/generate-dev-env.mjs
> ```
>
> Il génère 11 secrets indépendants et 2 paires de clés Ed25519 réelles, refuse d'écraser un `.env` existant sans `--force`, et écrit en `0600`.
>
> ✅ `docker/.env.example` était à 0 octet lors de l'audit du matin ; **rempli le même jour à 16:36**.

---

## 1. Règles

| Règle | |
|---|---|
| **Validation bloquante** | une variable manquante ou invalide fait échouer le démarrage : log `fatal`, code de sortie non nul. Jamais de valeur par défaut silencieuse |
| **`abortEarly: false`** | toutes les variables fautives sont signalées d'un coup, pas la première seulement |
| **Aucun défaut pour un secret** | un secret sans valeur explicite est une erreur, pas un cas nominal |
| **Aucun secret dans le code** | ni dans un test, ni dans un seed, ni dans un exemple |
| **`.env` jamais committé** | `.gitignore` racine le couvre déjà |
| **`.env.example` toujours à jour** | valeurs factices, jamais réelles. Ajouter une variable sans l'y ajouter est un défaut de PR |
| **Secrets en base64** | évite les problèmes d'échappement dans les fichiers `.env` et les gestionnaires de secrets |

Génération des secrets :

```bash
openssl rand -base64 32                              # secret HMAC 32 octets
openssl genpkey -algorithm ed25519 -out key.pem      # paire EdDSA
openssl pkey -in key.pem -pubout -out pub.pem
```

---

## 2. Backend — application

| Variable | Type | Défaut | Requis | Rôle |
|---|---|---|---|---|
| `NODE_ENV` | enum | — | ✔ | `development` `test` `staging` `production` |
| `PORT` | int | `3001` | ✔ | **3001, pas 3000** — 3000 est le port du serveur Next |
| `API_BASE_URL` | url | — | ✔ | URL publique, sert de `iss` |
| `TRUSTED_PROXY_HOPS` | int | `1` | ✔ | nombre de sauts. **Jamais `true`** — voir §8 |
| `SHUTDOWN_TIMEOUT_MS` | int | `15000` | | arrêt propre |
| `SWAGGER_ENABLED` | bool | `false` | | protégé hors développement |

---

## 3. Backend — PostgreSQL

| Variable | Type | Requis | Rôle |
|---|---|---|---|
| `DATABASE_URL` | url | ✔ | `postgresql://user:pass@host:5433/eventini?schema=public` |
| `SHADOW_DATABASE_URL` | url | dev/CI | détection de dérive Prisma. Base jetable, **jamais** la base applicative |
| `DATABASE_POOL_SIZE` | int | | défaut `10` |
| `DATABASE_CONNECT_TIMEOUT_MS` | int | | défaut `10000` |
| `DATABASE_STATEMENT_TIMEOUT_MS` | int | | défaut `30000` — borne les requêtes pathologiques |
| `DATABASE_SLOW_QUERY_THRESHOLD_MS` | int | | défaut `500` |

Le port hôte est **5433**, pas 5432 : `docker-compose.yml` décale les ports pour éviter les conflits avec une installation locale.

---

## 4. Backend — Redis

| Variable | Type | Requis | Rôle |
|---|---|---|---|
| `REDIS_URL` | url | ✔ | `redis://:password@host:6380/0` |
| `REDIS_QUEUE_DB` | int | | défaut `1` |
| `REDIS_PUBSUB_DB` | int | | défaut `2` |
| `REDIS_TLS_ENABLED` | bool | | défaut `false`, **`true` obligatoire** dès que Redis quitte l'hôte |
| `REDIS_CONNECT_TIMEOUT_MS` | int | | défaut `5000` |
| `REDIS_MAX_RETRIES` | int | | défaut `3` |

Port hôte **6380**, décalé comme PostgreSQL.

---

## 5. Backend — cryptographie

**Toutes requises. Aucune valeur par défaut. Aucune n'est dérivée d'une autre.**

| Variable | Type | Rôle |
|---|---|---|
| `ACCESS_TOKEN_PRIVATE_KEY` | base64 | clé privée Ed25519 — signature ([ADR-0005](../adr/0005-token-signing-eddsa.md)) |
| `ACCESS_TOKEN_PUBLIC_KEY` | base64 | clé publique — vérification |
| `ACCESS_TOKEN_KEY_ID` | string | `kid` courant, ex. `ak_2026_07` |
| `ACCESS_TOKEN_PREVIOUS_PUBLIC_KEY` | base64 | acceptée en vérification pendant la fenêtre de rotation |
| `ACCESS_TOKEN_PREVIOUS_KEY_ID` | string | |
| `ACCESS_TOKEN_ISSUER` | string | ex. `https://api.eventini.com` |
| `ACCESS_TOKEN_AUDIENCE_WEB` | string | `eventini-web` |
| `ACCESS_TOKEN_AUDIENCE_SCANNER` | string | `eventini-scanner` |
| `REFRESH_TOKEN_HMAC_SECRET` | base64 32o | HMAC des refresh tokens |
| `CSRF_SECRET` | base64 32o | signature des tokens CSRF |
| `MFA_ENCRYPTION_KEY` | base64 32o | AES-256-GCM des secrets TOTP |
| `INVITATION_TOKEN_SECRET` | base64 32o | |
| `PASSWORD_RESET_TOKEN_SECRET` | base64 32o | |
| `QR_SIGNING_PRIVATE_KEY` | base64 | Ed25519 — signature des tickets |
| `QR_SIGNING_PUBLIC_KEY` | base64 | |
| `QR_SIGNING_KEY_ID` | string | stocké dans `tickets.key_id` |
| **`PASSWORD_PEPPER`** | base64 32o | option `secret` d'Argon2 ([ADR-0007](../adr/0007-password-hashing-argon2id.md)) |
| `COOKIE_SECRET` | base64 32o | signature des cookies |

> 🔴 **`PASSWORD_PEPPER` est une donnée de sauvegarde critique.** Le perdre rend **tous** les mots de passe invérifiables — aucun utilisateur ne peut plus se connecter, et aucune restauration de base n'y remédie. Il doit être sauvegardé au même titre que la base, et séparément d'elle.

---

## 6. Backend — authentification

| Variable | Type | Défaut | Rôle |
|---|---|---|---|
| `ARGON2_MEMORY_COST` | int | `19456` | KiB |
| `ARGON2_TIME_COST` | int | `2` | |
| `ARGON2_PARALLELISM` | int | `1` | |
| `ARGON2_HASH_LENGTH` | int | `32` | octets |
| `PASSWORD_MIN_LENGTH` | int | `12` | |
| `PASSWORD_MAX_LENGTH` | int | `128` | |
| `ACCESS_TOKEN_TTL_WEB_ADMIN` | duration | `10m` | |
| `ACCESS_TOKEN_TTL_WEB_SUPER_ADMIN` | duration | `5m` | |
| `ACCESS_TOKEN_TTL_SCANNER` | duration | `15m` | |
| `REFRESH_TOKEN_TTL_WEB_ADMIN` | duration | `14d` | |
| `REFRESH_TOKEN_TTL_WEB_SUPER_ADMIN` | duration | `1d` | |
| `REFRESH_TOKEN_TTL_SCANNER` | duration | `30d` | |
| `SESSION_IDLE_TTL_WEB_ADMIN` | duration | `12h` | |
| `SESSION_IDLE_TTL_WEB_SUPER_ADMIN` | duration | `30m` | |
| `SESSION_IDLE_TTL_SCANNER` | duration | `7d` | |
| `SESSION_ABSOLUTE_TTL_WEB_ADMIN` | duration | `30d` | |
| `SESSION_ABSOLUTE_TTL_WEB_SUPER_ADMIN` | duration | `7d` | |
| `SESSION_ABSOLUTE_TTL_SCANNER` | duration | `90d` | |
| `PASSWORD_RESET_TTL` | duration | `30m` | |
| `EMAIL_VERIFICATION_TTL` | duration | `24h` | |
| `INVITATION_TTL` | duration | `7d` | |
| `MFA_CHALLENGE_TTL` | duration | `5m` | |
| `MFA_CHALLENGE_MAX_ATTEMPTS` | int | `5` | |
| `REAUTHENTICATION_TTL` | duration | `10m` | |
| `TOTP_DIGITS` | int | `6` | |
| `TOTP_PERIOD_SECONDS` | int | `30` | |
| `TOTP_DRIFT_WINDOWS` | int | `1` | |
| `RECOVERY_CODE_COUNT` | int | `10` | |
| `JWT_CLOCK_TOLERANCE_SECONDS` | int | `30` | |

Ces valeurs sont configurables mais **ne sont pas des variables de réglage libre** : les changer sans lire [ADR-0007](../adr/0007-password-hashing-argon2id.md) et [ADR-0009](../adr/0009-token-and-session-lifetimes.md) modifie la posture de sécurité.

---

## 7. Backend — cookies et CSRF

| Variable | Type | Défaut | Rôle |
|---|---|---|---|
| `COOKIE_ACCESS_NAME` | string | `__Host-eventini_access` | |
| `COOKIE_REFRESH_NAME` | string | `__Secure-eventini_refresh` | |
| `COOKIE_CSRF_NAME` | string | `__Host-eventini_csrf` | lisible par JS |
| `COOKIE_CSRF_CONTEXT_NAME` | string | `__Host-eventini_csrf_ctx` | pré-session |
| `COOKIE_REFRESH_PATH` | string | `/api/v1/auth/sessions` | limite l'exposition du refresh |
| `COOKIE_SECURE` | bool | `true` | **`false` uniquement en développement local** |
| `COOKIE_SAMESITE_ACCESS` | enum | `lax` | |
| `COOKIE_SAMESITE_REFRESH` | enum | `strict` | |
| `CSRF_CONTEXT_TTL` | duration | `30m` | |

---

## 8. Backend — CORS et origines

| Variable | Type | Rôle |
|---|---|---|
| `CORS_ALLOWED_ORIGINS` | csv | **origines exactes**, séparées par virgule |
| `CORS_MAX_AGE_SECONDS` | int | défaut `600` |

```bash
# correct
CORS_ALLOWED_ORIGINS=https://app.eventini.com,https://admin.eventini.com
```

Interdit : `*` avec credentials, tout motif ou joker, toute comparaison par `includes()`. La comparaison porte sur schéma + hôte + port, par égalité stricte.

> 🔴 **`TRUSTED_PROXY_HOPS` ne doit jamais valoir `true` ni un nombre trop élevé.** Avec `trust proxy = true`, Express accepte le `X-Forwarded-For` fourni par le client : **n'importe qui contourne alors tout rate limiting par IP** en forgeant l'en-tête. C'est l'erreur la plus courante des implémentations de rate limiting.

---

## 9. Backend — rate limiting

| Variable | Type | Défaut |
|---|---|---|
| `RATE_LIMIT_GLOBAL_IP` | int/min | `300` |
| `RATE_LIMIT_GLOBAL_USER` | int/min | `1000` |
| `RATE_LIMIT_GLOBAL_ORG` | int/min | `5000` |
| `RATE_LIMIT_LOGIN_IP_EMAIL` | int | `5` |
| `RATE_LIMIT_LOGIN_IP_EMAIL_WINDOW` | duration | `15m` |
| `RATE_LIMIT_LOGIN_IP` | int | `20` |
| `RATE_LIMIT_MFA_VERIFY` | int | `5` |
| `RATE_LIMIT_REFRESH` | int/h | `30` |
| `RATE_LIMIT_PASSWORD_RESET_EMAIL` | int/h | `3` |
| `RATE_LIMIT_CHECKIN_DEVICE` | int/min | `600` |
| `LOCKOUT_THRESHOLDS` | csv | `5,10,15` |
| `LOCKOUT_DURATIONS` | csv duration | `15m,1h,24h` |
| `RATE_LIMIT_FAIL_MODE_AUTH` | enum | `closed` |
| `RATE_LIMIT_FAIL_MODE_OTHER` | enum | `open` |

Détail : [`RATE_LIMITING_AND_ABUSE_PREVENTION.md`](../security/RATE_LIMITING_AND_ABUSE_PREVENTION.md).

---

## 10. Backend — limites de ressources

| Variable | Type | Défaut |
|---|---|---|
| `BODY_LIMIT_JSON` | size | `100kb` |
| `BODY_LIMIT_IMPORT` | size | `10mb` |
| `PAGINATION_DEFAULT_LIMIT` | int | `20` |
| `PAGINATION_MAX_LIMIT` | int | `100` |
| `SEARCH_MIN_LENGTH` | int | `2` |
| `SEARCH_MAX_LENGTH` | int | `100` |
| `IMPORT_MAX_ROWS` | int | `50000` |
| `ATTENDANCE_SYNC_MAX_OPERATIONS` | int | `500` |
| `JOB_MAX_CONCURRENT_PER_ORG` | int | `3` |
| `JOB_TIMEOUT_MS` | int | `900000` |
| `JOB_MAX_ATTEMPTS` | int | `5` |
| `IDEMPOTENCY_RETENTION` | duration | `24h` |
| `IDEMPOTENCY_RETENTION_ATTENDANCE` | duration | `7d` |
| `QR_REPLAY_WINDOW_SECONDS` | int | `90` |
| `SSE_MAX_CONNECTIONS_PER_USER` | int | `10` |

---

## 11. Backend — email

| Variable | Type | Requis | Rôle |
|---|---|---|---|
| `SMTP_HOST` | string | ✔ | |
| `SMTP_PORT` | int | ✔ | |
| `SMTP_USER` | string | ✔ | |
| `SMTP_PASSWORD` | string | ✔ | **secret** |
| `SMTP_SECURE` | bool | | défaut `true` |
| `MAIL_FROM_ADDRESS` | email | ✔ | |
| `MAIL_FROM_NAME` | string | | défaut `Eventini` |
| `MAIL_REPLY_TO` | email | | |
| `WEB_BASE_URL` | url | ✔ | construction des liens d'invitation et de reset |

---

## 12. Backend — observabilité

Les 12 variables du Document D §38, **inchangées** :

`LOG_LEVEL` · `LOG_FORMAT` · `LOG_PRETTY` · `LOG_SERVICE_NAME` · `LOG_SERVICE_VERSION` · `LOG_REDACTION_ENABLED` · `LOG_HTTP_ENABLED` · `LOG_HTTP_SUCCESS_ENABLED` · `LOG_SLOW_REQUEST_THRESHOLD_MS` · `LOG_SLOW_QUERY_THRESHOLD_MS` · `LOG_DEBUG_MODULES` · `LOG_DEBUG_EXPIRES_AT`

| Env | `LOG_LEVEL` | `LOG_FORMAT` | `LOG_PRETTY` | `LOG_REDACTION_ENABLED` |
|---|---|---|---|---|
| Local | `debug` | `pretty` | `true` | `true` |
| Test | `silent` | `json` | `false` | `true` |
| CI | `warn` | `json` | `false` | `true` |
| Staging | `info` | `json` | `false` | `true` |
| Production | `info` | `json` | `false` | `true` |

**`LOG_REDACTION_ENABLED=false` est interdit hors développement local.** La validation d'environnement le refuse si `NODE_ENV` vaut `staging` ou `production`.

Plus : `METRICS_ENABLED` (défaut `true`), `METRICS_PATH` (`/metrics`), `OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_SERVICE_NAME`, `INSTANCE_ID`.

---

## 13. Backend — bootstrap

| Variable | Type | Rôle |
|---|---|---|
| `BOOTSTRAP_SUPER_ADMIN_EMAIL` | email | premier `SUPER_ADMIN`, créé en `PENDING`, **sans mot de passe** |
| `SEED_DEMO_DATA` | bool | défaut `false`. **Refusé si `NODE_ENV=production`** |

Aucun mot de passe n'est jamais fourni par variable d'environnement. Voir [`MIGRATION_STRATEGY.md` §8.2](../database/MIGRATION_STRATEGY.md).

---

## 14. Frontend

Il n'existe **aucun** `.env` sous `web/` aujourd'hui.

| Variable | Type | Requis | Rôle |
|---|---|---|---|
| `NEXT_PUBLIC_API_BASE_URL` | url | ✔ | **doit pointer sur 3001**, pas 3000 |
| `NEXT_PUBLIC_APP_URL` | url | ✔ | |
| `NEXT_PUBLIC_DEFAULT_LOCALE` | string | | défaut `fr` |
| `NEXT_PUBLIC_ENVIRONMENT` | enum | | affichage d'un bandeau hors production |

> 🔴 **Tout ce qui est préfixé `NEXT_PUBLIC_` est embarqué dans le bundle JavaScript et visible par tous.** Aucun secret ne doit jamais porter ce préfixe. Le frontend n'a besoin d'aucun secret : l'authentification passe par des cookies posés par le backend.

**Défaut cassé aujourd'hui** : `environment.ts` retombe sur `http://localhost:3000`, le port du serveur Next lui-même. Sans `.env`, le front s'appelle lui-même et chaque appel API donne 404. D'où `PORT=3001` côté backend.

---

## 15. Docker

`docker/.env` existe et fonctionne. `docker/.env.example` a été **rempli le 30 juillet 2026** (il était à 0 octet lors de l'audit du matin) : 9 variables, valeurs factices.

| Variable | Rôle |
|---|---|
| `POSTGRES_USER` `POSTGRES_PASSWORD` `POSTGRES_DB` `POSTGRES_PORT` | port hôte **5433** |
| `PGADMIN_DEFAULT_EMAIL` `PGADMIN_DEFAULT_PASSWORD` `PGADMIN_PORT` | port hôte **5051** |
| `REDIS_PASSWORD` `REDIS_PORT` | port hôte **6380** |

À remplir au sprint 01 avec des valeurs factices explicitement marquées comme telles.

---

## 16. Résumé par environnement

| Variable | dev | test | staging | production |
|---|---|---|---|---|
| `NODE_ENV` | `development` | `test` | `staging` | `production` |
| `COOKIE_SECURE` | `false` | `false` | `true` | `true` |
| `LOG_LEVEL` | `debug` | `silent` | `info` | `info` |
| `LOG_PRETTY` | `true` | `false` | `false` | `false` |
| `LOG_REDACTION_ENABLED` | `true` | `true` | `true` | `true` |
| `SWAGGER_ENABLED` | `true` | `false` | `true` (protégé) | `false` |
| `SEED_DEMO_DATA` | `true` | `true` | `false` | **refusé** |
| `REDIS_TLS_ENABLED` | `false` | `false` | `true` | `true` |
| `SHADOW_DATABASE_URL` | ✔ | ✔ | — | — |

---

## 17. Vérifications au démarrage

La validation ne se contente pas de vérifier la présence. Elle applique des règles croisées :

| # | Règle | Sinon |
|---|---|---|
| 1 | Toutes les variables requises sont présentes | `fatal`, liste **complète** des manquantes |
| 2 | `NODE_ENV=production` ⇒ `COOKIE_SECURE=true` | `fatal` |
| 3 | `NODE_ENV=production` ⇒ `LOG_REDACTION_ENABLED=true` | `fatal` |
| 4 | `NODE_ENV=production` ⇒ `SEED_DEMO_DATA=false` | `fatal` |
| 5 | `NODE_ENV=production` ⇒ `CORS_ALLOWED_ORIGINS` en `https://` uniquement | `fatal` |
| 6 | `TRUSTED_PROXY_HOPS` est un entier ≥ 0 | `fatal` |
| 7 | Tous les secrets font ≥ 32 octets décodés | `fatal` |
| 8 | Aucun secret n'est égal à un autre | `fatal` — la réutilisation de clé annule leur séparation |
| 9 | Aucun secret ne vaut une valeur d'exemple connue | `fatal` |
| 10 | `ACCESS_TOKEN_PUBLIC_KEY` correspond bien à `ACCESS_TOKEN_PRIVATE_KEY` | `fatal` |
| 11 | `PAGINATION_DEFAULT_LIMIT` ≤ `PAGINATION_MAX_LIMIT` | `fatal` |
| 12 | `SESSION_IDLE_TTL_*` ≤ `SESSION_ABSOLUTE_TTL_*` | `fatal` |
| 13 | `LOCKOUT_THRESHOLDS` et `LOCKOUT_DURATIONS` ont la même longueur | `fatal` |
| 14 | `ARGON2_MEMORY_COST` ≥ 19456 | `fatal` — sous ce seuil, on quitte la recommandation OWASP |
| 15 | Un nom de cookie préfixé `__Host-` / `__Secure-` ⇒ `COOKIE_SECURE=true` | `fatal` — sinon le navigateur jette le cookie **en silence** |

Les règles 8, 9 et 10 sont celles qui attrapent les vraies erreurs de déploiement : un copier-coller de secret, un exemple laissé en place, une paire de clés dépareillée.

### 🔴 Règle 15 — le défaut qu'elle ferme

`.env.example` livrait `COOKIE_SECURE=false` avec **quatre** noms préfixés. La spécification des préfixes de cookies impose au navigateur de refuser un cookie `__Host-` ou `__Secure-` dépourvu de l'attribut `Secure` : Chrome les jetait donc tous les quatre.

Le symptôme, observé le 16 août 2026 sur un poste de développement : `GET /auth/csrf-token` répond `200` avec son jeton, aucun cookie n'est stocké, `document.cookie` reste vide, le client n'envoie pas d'en-tête `X-CSRF-Token`, et **toute connexion locale échoue en `403 AUTH_CSRF_INVALID`** avec des identifiants parfaitement valides.

Ce qui rend le cas coûteux à diagnostiquer, c'est qu'aucun des deux côtés n'a tort. Le serveur refuse à juste titre, le client n'a rien à envoyer, et le seul endroit où quelque chose se perd est un rejet du navigateur qui n'apparaît dans aucun log — ni côté serveur, ni côté client, ni dans l'onglet réseau, où la réponse `200` du jeton semble parfaitement normale.

**Le réglage retenu est `COOKIE_SECURE=true`, y compris en local.** Les navigateurs traitent `http://localhost` comme une origine sûre et acceptent `Secure` dessus, donc cela ne coûte rien ; et cela garde des noms de cookies **identiques** entre développement et production, ce qui empêche un bug lié au nom de n'apparaître qu'en production. Retirer les préfixes est l'autre option valide — la règle accepte les deux, et refuse leur mélange.

> ✅ **Implémentées et testées** — `backend/src/config/rules/`, une règle par fichier, chacune couverte par des tests qui vérifient le **refus**, pas seulement l'acceptation. Comportement observé sur un démarrage réel sans `.env` : les 25 variables manquantes sont nommées dans un seul message, avec un code de sortie non nul.
>
> Les placeholders de `.env.example` sont **délibérément assez longs pour satisfaire la règle 7**, afin que la règle 9 soit celle qui les signale : « vous avez déployé le fichier d'exemple » plutôt qu'une plainte trompeuse sur l'entropie.

Échec ⇒ log `fatal`, message nommant **toutes** les variables fautives, code de sortie non nul. L'orchestrateur redémarre, échoue à nouveau, et le déploiement est marqué en échec — ce qui est le comportement voulu. Un service qui démarre à moitié configuré est bien pire.
