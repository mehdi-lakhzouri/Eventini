# Eventini — Authentification et autorisation

> **Statut :** Spécification normative · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Niveau visé :** OWASP ASVS niveau 2, renforcé pour `SUPER_ADMIN`
> **Complète :** [`AUTHENTICATION_SECURITY_BASELINE.md`](AUTHENTICATION_SECURITY_BASELINE.md) (Document B) — les invariants `AUTH-INV-001` à `AUTH-INV-012` restent normatifs
> **Ce document fournit les valeurs que le Document B laissait ouvertes.**

> ⚠️ **État réel au 30 juillet 2026 : rien de ceci n'est implémenté.** Le backend expose **zéro** route — aucun décorateur `@Get`/`@Post` n'existe dans `backend/src`. Les deux `@Controller` présents (`identity/authentication`, `identity/csrf`) ont un corps vide. `ArgonPasswordHasher`, `PermissionsGuard`, `TenantContextGuard`, `CsrfGuard` sont des classes vides sans `@Injectable()`. Ce document est la cible.

---

## 1. Les nombres

Tout ce que le corpus laissait en « paramètres configurables », « seuils progressifs » ou « 5 à 15 minutes ».

### 1.1 Mots de passe — [ADR-0007](../adr/0007-password-hashing-argon2id.md)

```
algorithme    Argon2id
memoryCost    19456 KiB (19 MiB)
timeCost      2
parallelism   1
hashLength    32 octets
sel           16 octets, généré par la bibliothèque
pepper        option native `secret`, 32 octets, hors PostgreSQL
```

| Politique | Valeur |
|---|---|
| Longueur minimale | 12 caractères |
| Longueur maximale | 128 caractères |
| Règles de composition | **aucune** |
| Normalisation | NFKC |
| Rehash | automatique et transparent si `password_version` < profil courant |

### 1.2 Tokens — [ADR-0005](../adr/0005-token-signing-eddsa.md), [ADR-0009](../adr/0009-token-and-session-lifetimes.md)

```
signature     EdDSA (Ed25519) via `jose`, en-tête `kid`
iss           https://api.eventini.com
aud           eventini-web | eventini-scanner
tolérance     30 s sur exp et iat
refresh       32 octets opaques, HMAC-SHA-256 en base
```

| Profil | access | refresh | idle | absolue |
|---|---|---|---|---|
| `WEB` / `CLIENT_ADMIN` | 10 min | 14 j | 12 h | 30 j |
| `WEB` / `SUPER_ADMIN` | 5 min | 1 j | 30 min | 7 j |
| `MOBILE_SCANNER` | 15 min | 30 j | 7 j | 90 j |

| Token à usage unique | Durée |
|---|---|
| Reset de mot de passe | 30 min |
| Vérification d'email | 24 h |
| Invitation | 7 j |
| Challenge MFA | 5 min, 5 tentatives |
| Preuve de réauthentification | 10 min |
| Nonce anti-rejeu QR | 90 s |

### 1.3 MFA

```
type          TOTP
algorithme    SHA-1        (compatibilité des applications d'authentification)
chiffres      6
période       30 s
dérive        ±1 fenêtre
secret        160 bits, chiffré au repos, jamais haché
recovery      10 codes, 10 caractères Crockford base32, SHA-256, usage unique
```

SHA-1 pour TOTP n'est pas une faiblesse : la RFC 6238 le prévoit, la sécurité repose sur l'entropie du secret et la fenêtre courte, et SHA-256 casse la compatibilité avec une partie des applications d'authentification.

### 1.4 Rate limiting et lockout — [ADR-0013](../adr/0013-rate-limiting-and-lockout-baseline.md)

Détail complet : [`RATE_LIMITING_AND_ABUSE_PREVENTION.md`](RATE_LIMITING_AND_ABUSE_PREVENTION.md).

```
login             5 / 15 min (ip+email)  ·  20 / 15 min (ip)
lockout ip+email  5 échecs → 15 min  ·  10 → 1 h  ·  15 → 24 h
```

---

## 2. Cookies

| | Access | Refresh | Contexte CSRF | CSRF lisible |
|---|---|---|---|---|
| **Nom** | `__Host-eventini_access` | `__Secure-eventini_refresh` | `__Host-eventini_csrf_ctx` | `__Host-eventini_csrf` |
| `HttpOnly` | `true` | `true` | `true` | **`false`** |
| `Secure` | `true` (prod) | `true` (prod) | `true` (prod) | `true` (prod) |
| `SameSite` | `Lax` | **`Strict`** | `Lax` | `Lax` |
| `Path` | `/` | **`/api/v1/auth/sessions`** | `/` | `/` |
| `Domain` | absent | absent | absent | absent |
| Durée | = access token | = refresh token | 30 min | = session |

Trois points que le Document B laissait ouverts sont ici tranchés ([ADR-0016](../adr/0016-pre-session-csrf-binding.md)) :

- **`SameSite=Strict` pour le refresh**, pas `Lax`. Le refresh n'est jamais déclenché par une navigation entrante ; `Strict` est donc sans coût ergonomique et supprime une classe entière d'attaques.
- **`Path` du refresh** enfin nommé : `/api/v1/auth/sessions`. Le refresh token n'est pas envoyé au reste de l'API, donc une faille ailleurs ne l'expose pas.
- **Préfixe `__Host-` sur le cookie CSRF lisible.** Il était le seul sans préfixe (C-18) alors que `__Host-` lui est applicable : il n'exige pas `HttpOnly`, seulement `Secure`, `Path=/` et l'absence de `Domain`.

**Suppression d'un cookie** : rejouer nom, `Path`, `Domain`, `SameSite`, `Secure` **et `HttpOnly`**. Le Document B §14.4 omettait `HttpOnly` (C-19) ; un navigateur peut alors ne pas reconnaître le cookie à supprimer.

**AUTH-INV-001** — aucun token web dans `localStorage`, `sessionStorage`, Zustand, Redux, IndexedDB ou le cache TanStack Query. Le seul cookie lisible par JavaScript est le CSRF, et il ne porte aucune autorisation.

---

## 3. CSRF

### 3.1 Le problème résolu

Le Document B se contredisait : `GET /auth/csrf` était classé pré-authentification (§44.1), mais la validation exigeait « cookie d'authentification » et « session active » en étapes 1 et 2 (§15.3). Un `POST` de login n'a ni l'un ni l'autre. Le flux était **inimplémentable** (C-16).

### 3.2 Deux modes de liaison

**Mode pré-session** — `GET /api/v1/auth/csrf-token` sans session :

1. génération d'un identifiant de contexte anonyme → `__Host-eventini_csrf_ctx` (`HttpOnly`, 30 min) ;
2. émission d'un token CSRF signé, lié à cet identifiant → `__Host-eventini_csrf` (lisible) ;
3. le client renvoie la valeur en header `X-CSRF-Token`.

**Mode session** — après authentification, le token est régénéré et lié au `sessionId` réel. Le cookie de contexte anonyme est supprimé.

**Rebinding au login** — `POST /auth/sessions` valide en mode pré-session, puis émet un nouveau token lié à la session créée. Un token pré-session capturé ne survit pas au login.

### 3.3 Ordre de validation

| # | Contrôle | Pré-session | Session |
|---|---|---|---|
| 1 | Méthode mutante (`POST` `PUT` `PATCH` `DELETE`) | ✔ | ✔ |
| 2 | En-tête `Origin` présent et exactement autorisé | ✔ | ✔ |
| 3 | Cookie CSRF présent | ✔ | ✔ |
| 4 | Header `X-CSRF-Token` présent | ✔ | ✔ |
| 5 | Cookie et header identiques | ✔ | ✔ |
| 6 | Signature valide | ✔ | ✔ |
| 7 | Liaison au contexte anonyme | ✔ | — |
| 8 | Cookie d'authentification présent | — | ✔ |
| 9 | Session active en base | — | ✔ |
| 10 | Liaison à `sessionId` | — | ✔ |

Échec ⇒ `403 AUTH_CSRF_INVALID` + security event `CSRF_VALIDATION_FAILED`. Aucun détail sur l'étape en échec n'est renvoyé.

### 3.4 Exemptions

Exempts, et uniquement ceux-là : `/health/live`, `/health/ready`, `/health/startup`, `/metrics`, et les endpoints mobiles porteurs d'un `Authorization: Bearer` **sans aucun cookie**.

**Jamais exempts** : login, changement de mot de passe, logout, refresh, changement de rôle, création ou modification d'événement, kill-switch, check-in.

### 3.5 Origin et CORS

```
origines autorisées   https://app.eventini.com
                      https://admin.eventini.com
                      (par environnement, liste exacte, jamais de motif)
credentials           true
méthodes              GET POST PUT PATCH DELETE OPTIONS
headers acceptés      Content-Type, X-CSRF-Token, Idempotency-Key,
                      If-Match, traceparent, X-Request-Id
headers exposés       X-Request-Id, ETag, Retry-After,
                      RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset
preflight max-age     600 s
```

La comparaison d'`Origin` porte sur **schéma + hôte + port**, par égalité stricte. `origin.includes("eventini.com")` est explicitement interdit : `https://eventini.com.attacker.tld` passerait. `Access-Control-Allow-Origin: *` avec `credentials: true` est interdit — le navigateur le refuse de toute façon, mais l'écrire signale une incompréhension du modèle.

`Referer` sert de repli **contrôlé** uniquement quand `Origin` est absent.

---

## 4. En-têtes de sécurité

Via Helmet, avec des valeurs explicites — le Document B §43 listait les 7 en-têtes sans jamais donner une directive.

```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(self), microphone=(), geolocation=(), payment=()
X-Frame-Options: DENY
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
```

`X-Powered-By` est retiré. `camera=(self)` est nécessaire : le scanner web lit un QR code.

**CSP** — compatible Next.js sans être permissive :

```
default-src 'self';
script-src 'self' 'nonce-{RANDOM}' 'strict-dynamic';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
font-src 'self';
connect-src 'self' https://api.eventini.com;
frame-ancestors 'none';
base-uri 'self';
form-action 'self';
object-src 'none';
upgrade-insecure-requests;
```

`'unsafe-inline'` sur `style-src` est un compromis assumé : Tailwind et Base UI injectent des styles inline, et un nonce sur les styles casse l'hydratation React. Le risque résiduel est faible — `script-src` reste protégé par nonce, et c'est là que se joue le XSS.

`frame-ancestors 'none'` **et** `X-Frame-Options: DENY` : le second couvre les navigateurs qui ignorent le premier.

---

## 5. Flux d'authentification

### 5.1 Login — `POST /api/v1/auth/sessions`

```
 1  valider le corps (email, password) — class-validator, whitelist stricte
 2  normaliser l'email (minuscules, trim, NFKC)
 3  rate limit ip+email et ip                    → 429 si dépassé
 4  vérifier le lockout ip+email                 → réponse générique si verrouillé
 5  valider le CSRF en mode pré-session          → 403 AUTH_CSRF_INVALID
 6  chercher l'utilisateur par normalized_email
 7  vérifier Argon2id — TOUJOURS, même si l'utilisateur n'existe pas
    (hash factice, pour égaliser le temps de réponse)
 8  échec → enregistrer l'échec, security event LOGIN_FAILED,
           réponse générique AUTH_INVALID_CREDENTIALS
 9  users.status = ACTIVE ?                      → réponse générique
10  MFA requis ? (méthode ACTIVE, ou rôle SUPER_ADMIN)
      oui → créer un challenge MFA (5 min), retourner AUTH_MFA_REQUIRED
            AUCUNE session complète, AUCUN access token
11  résoudre l'organisation par défaut :
      un seul membership ACTIVE   → celui-là
      plusieurs                   → aucun ; le client doit appeler l'activation
      aucun, mais rôle plateforme → session PLATFORM (organization_id NULL)
      aucun et pas de rôle        → 403
12  vérifier organizations.status = ACTIVE et is_enabled = true
13  vérifier organization_memberships.status = ACTIVE
14  TRANSACTION :
      créer user_sessions (token_family_id, idle/absolute selon le profil)
      créer refresh_token_rotations (ACTIVE, HMAC du token)
      mettre à jour users.last_login_at
15  générer l'access token (EdDSA, kid courant)
16  générer le token CSRF lié à la session
17  poser les 3 cookies + supprimer le cookie de contexte anonyme
18  remettre à zéro le compteur de lockout ip+email
19  security event LOGIN_SUCCEEDED + SESSION_CREATED
20  retourner le profil minimal
```

L'étape 7 est essentielle : sans vérification factice quand le compte n'existe pas, l'écart de temps de réponse révèle l'existence du compte. C'est de l'énumération d'utilisateurs par canal auxiliaire.

L'étape 11 traite le cas que le Document B ignorait : un utilisateur membre de plusieurs organisations. Il obtient une session **sans organisation active** et doit appeler `POST /organizations/{id}/activation`. Aucune organisation n'est choisie à sa place.

### 5.2 Rotation — `POST /api/v1/auth/sessions/current/rotation`

```
 1  lire le cookie refresh                       → 401 si absent
 2  valider CSRF + Origin
 3  rate limit par session (30/h)
 4  calculer le HMAC du token présenté
 5  chercher la ligne refresh_token_rotations par token_hash
      absente                    → 401, security event
      status ≠ ACTIVE            → REJEU, voir 5.3
 6  charger la session, vérifier ACTIVE, idle et absolute non dépassés
 7  revérifier user, organisation, membership (ils ont pu changer)
 8  TRANSACTION :
      ancienne ligne → CONSUMED, consumed_at
      nouvelle ligne → ACTIVE (ux_refresh_active_per_family arbitre la concurrence)
      chaîner previous_token_id / replaced_by_token_id
      session : last_seen_at, idle_expires_at repoussé
                absolute_expires_at INCHANGÉ
 9  nouvel access token, nouveau token CSRF
10  reposer les cookies
11  security event SESSION_REFRESHED
```

À l'étape 8, deux rotations concurrentes avec le même token ne peuvent pas réussir toutes les deux : l'index unique partiel les départage. Aucun verrou applicatif n'est nécessaire — un verrou Redis ne remplacerait jamais une contrainte PostgreSQL.

### 5.3 Détection de rejeu

Déclenchée dès qu'un token présenté correspond à une ligne `CONSUMED`, `REVOKED` ou `EXPIRED`.

```
1  ligne → REUSED, reuse_detected_at
2  TOUTE la famille token_family_id → REVOKED
3  session → COMPROMISED puis REVOKED
4  invalider le cache Redis de la session
5  supprimer les cookies web
6  security event REFRESH_TOKEN_REUSE_DETECTED, sévérité CRITICAL
7  alerte immédiate (Document D §35)
8  notification optionnelle à l'utilisateur
```

**Aucun nouveau token n'est émis.** La ré-authentification complète est exigée. La famille entière tombe, pas seulement le token rejoué : on ne sait pas lequel des deux porteurs est légitime, donc les deux perdent l'accès.

### 5.4 Déconnexion

| Opération | Route | Effet |
|---|---|---|
| Déconnexion | `DELETE /api/v1/auth/sessions/current` | session `REVOKED`, famille révoquée, cache invalidé, 3 cookies supprimés, audit |
| Déconnexion globale | `DELETE /api/v1/auth/sessions` | toutes les sessions `ACTIVE` de l'utilisateur révoquées, `users.version` incrémenté, tous les caches invalidés, `ALL_SESSIONS_REVOKED` |
| Révocation ciblée | `DELETE /api/v1/auth/sessions/{sessionId}` | vérifie que la session appartient bien à l'appelant, puis révoque |

L'incrément de `users.version` à la déconnexion globale invalide immédiatement tous les access tokens en circulation, sans attendre leur expiration.

### 5.5 Révocation automatique — 12 déclencheurs

Les 10 du Document B §25.3, plus 2 issus du modèle de données :

changement de mot de passe · reset de mot de passe · désactivation d'utilisateur · retrait de membership · changement de rôle critique · suspension d'organisation · rejeu de refresh · appareil perdu · kill-switch · compromission détectée · **changement d'organisation active** ([ADR-0002](../adr/0002-active-organization-resolution.md)) · **révocation d'un `scanner_device`**.

---

## 6. Autorisation

### 6.1 La chaîne en 8 étapes

Elle est **la** frontière de sécurité. Le frontend peut masquer une action ; il ne décide jamais.

| # | Étape | Source | Refus |
|---|---|---|---|
| 1 | Identité — signature, `iss`, `aud`, `exp`, `alg` explicite | access token | `401 AUTHENTICATION_REQUIRED` |
| 2 | Session — `ACTIVE`, idle et absolue non dépassées | `user_sessions` | `401 AUTH_SESSION_EXPIRED` / `AUTH_SESSION_REVOKED` |
| 3 | Utilisateur — `ACTIVE`, `version` = claim `ver` | `users` | `401` |
| 4 | Tenant — organisation `ACTIVE` et `is_enabled` | `organizations` | `403 AUTH_TENANT_DENIED` |
| 5 | Membership — `ACTIVE` | `organization_memberships` | `403 AUTH_TENANT_DENIED` |
| 6 | Permission — présente dans l'ensemble effectif | cache / base | `403 AUTH_PERMISSION_DENIED` |
| 7 | **Propriété** — `resource.organization_id` = contexte | la ressource | `403 AUTH_TENANT_DENIED` |
| 8 | **État** — l'état de la ressource autorise l'action | la ressource | `409` + code métier |

Les étapes **7 et 8 sont ce qui distingue l'autorisation de l'authentification**. Sans elles, un identifiant valide appartenant à un autre tenant passe : c'est exactement BOLA / IDOR. Elles ne sont jamais optionnelles.

### 6.2 Portées

| Portée | Table d'assignation | Exemple |
|---|---|---|
| `PLATFORM` | `platform_role_assignments` | `platform.kill_switch.execute` |
| `ORGANIZATION` | `membership_role_assignments` | `organizations.manage` |
| `EVENT` | `event_user_assignments` | `attendance.check_in` |
| `SESSION` | `scanner_device_assignments.allowed_session_ids` | restriction à un atelier |

Une permission d'organisation **n'accorde pas** automatiquement l'accès à tous les événements. Un utilisateur peut être `CLIENT_ADMIN` de l'organisation A, simple analyste de B, autorisé uniquement sur l'événement X de B, et sans aucun droit sur l'événement Y — c'est l'exemple du contexte produit §7.3, et le modèle le supporte littéralement.

### 6.3 Résolution et cache

```
clé    perms:{membershipId}:v{permissionsVersion}     TTL 300 s
       perms:platform:{userId}:v{permissionsVersion}  TTL  60 s
```

`permissionsVersion` est incrémenté **dans la transaction** de tout changement de rôle, de membership ou de statut d'organisation. L'incrément rend l'ancienne version inatteignable — aucune suppression de clé, aucune fenêtre d'incohérence.

Redis indisponible ⇒ lecture PostgreSQL, log `warn`, métrique `redis_fallback_total`. **Jamais** de repli sur « autoriser ».

### 6.4 Décorateur

```ts
@RequirePermission('events.update', { scope: 'EVENT', param: 'eventId' })
@RequireAuthLevel('REAUTHENTICATED')          // opérations sensibles
```

Le guard lit les métadonnées, exécute les 8 étapes, injecte le `TenantContext`. Aucun controller ne fait de vérification d'autorisation à la main : ce qui est écrit une fois par endpoint finit par être oublié une fois.

### 6.5 Réauthentification — 10 opérations

changement de mot de passe · désactivation MFA · régénération des recovery codes · changement d'email · assignation `SUPER_ADMIN` · kill-switch · suppression définitive · rotation de clé QR · impersonation · révocation globale.

Preuve valable **10 minutes**, liée à la session, non transférable, tracée en audit. Portée par `user_sessions.authentication_level = REAUTHENTICATED`.

---

## 7. Catalogue des codes d'erreur d'authentification

| Code | HTTP | Quand |
|---|---|---|
| `AUTHENTICATION_REQUIRED` | 401 | aucun token, ou token invalide |
| `AUTH_INVALID_CREDENTIALS` | 401 | échec de login — **toujours générique** |
| `AUTH_SESSION_EXPIRED` | 401 | session expirée (idle ou absolue) |
| `AUTH_SESSION_REVOKED` | 401 | session révoquée |
| `AUTH_MFA_REQUIRED` | 401 | MFA attendu, challenge créé |
| `AUTH_MFA_INVALID` | 401 | code TOTP ou recovery invalide |
| `AUTH_CSRF_INVALID` | 403 | échec d'une des 10 validations CSRF |
| `AUTH_ORIGIN_DENIED` | 403 | `Origin` absent ou non autorisé |
| `AUTH_TENANT_DENIED` | 403 | étape 4, 5 ou 7 en échec |
| `AUTH_PERMISSION_DENIED` | 403 | étape 6 en échec |
| `AUTH_REAUTHENTICATION_REQUIRED` | 403 | opération sensible, `authLevel` insuffisant |
| `AUTH_REFRESH_REUSE_DETECTED` | 401 | rejeu, famille révoquée |
| `AUTH_ACCOUNT_LOCKED` | 401 | **jamais renvoyé au client** — journalisé uniquement |
| `RATE_LIMIT_EXCEEDED` | 429 | dépassement de limite |

**`AUTH_ACCOUNT_LOCKED` n'est jamais renvoyé.** Un compte verrouillé reçoit `AUTH_INVALID_CREDENTIALS`. Annoncer le verrouillage confirme l'existence du compte et informe l'attaquant du succès de son déni de service.

Ce qui n'est **jamais** exposé : trace d'exécution, erreur Prisma, motif exact d'échec de login, détail de signature JWT, existence d'un compte, existence d'une invitation.

---

## 8. Catalogue des security events

| Domaine | Codes |
|---|---|
| Authentification | `LOGIN_SUCCEEDED` `LOGIN_FAILED` `ACCOUNT_LOCKED` |
| MFA | `MFA_CHALLENGE_CREATED` `MFA_SUCCEEDED` `MFA_FAILED` `MFA_ENABLED` `MFA_DISABLED` |
| Sessions | `SESSION_CREATED` `SESSION_REFRESHED` `SESSION_REVOKED` `ALL_SESSIONS_REVOKED` `SESSION_COMPROMISED` `REFRESH_TOKEN_REUSE_DETECTED` |
| Mots de passe | `PASSWORD_CHANGED` `PASSWORD_RESET_REQUESTED` `PASSWORD_RESET_COMPLETED` |
| Autorisation | `ROLE_CHANGED` `ROLE_ESCALATION_ATTEMPTED` `MEMBERSHIP_REVOKED` `TENANT_ACCESS_DENIED` `REAUTHENTICATION_REQUIRED` |
| Web | `CSRF_VALIDATION_FAILED` `ORIGIN_VALIDATION_FAILED` `RATE_LIMIT_EXCEEDED` |
| Organisation | `ORGANIZATION_SUSPENDED` `ORGANIZATION_KILL_SWITCH_EXECUTED` `ORGANIZATION_CONTEXT_SWITCHED` |
| Tickets et scanners | `TICKET_SIGNATURE_INVALID` `TICKET_REPLAY_DETECTED` `SCANNER_DEVICE_REVOKED` |
| Système | `IDEMPOTENCY_CONFLICT_DETECTED` `UNSCOPED_QUERY_EXECUTED` `SIGNING_KEY_ROTATED` |

Union des quatre catalogues concurrents du corpus (C-11), plus les codes nés des nouveaux domaines. Métadonnées autorisées : `requestId` `traceId` `userId` `sessionId` `organizationId` `eventId` `clientType` `deviceId` `timestamp` `result` `reasonCode` `severity`.

**Jamais journalisé** : mot de passe, access token, refresh token, cookie complet, secret MFA, recovery code, token de reset, token d'invitation, payload QR complet.

---

## 9. Gestion des clés

Sept secrets **indépendants**, jamais dérivés les uns des autres (Document B §40.2) :

| Secret | Usage | Rotation |
|---|---|---|
| Signature access token | EdDSA Ed25519 | `kid` + fenêtre ≥ 30 j |
| Signature CSRF | HMAC-SHA-256 | fenêtre 30 min |
| Chiffrement MFA | AES-256-GCM | rechiffrement par lot |
| HMAC refresh | HMAC-SHA-256 | fenêtre ≥ durée refresh la plus longue |
| Token d'invitation | HMAC-SHA-256 | fenêtre 7 j |
| Reset de mot de passe | HMAC-SHA-256 | fenêtre 30 min |
| Signature QR | EdDSA Ed25519 | `key_id` sur `tickets`, fenêtre = durée d'événement |
| **Pepper mot de passe** | option `secret` d'Argon2 | rehash opportuniste, procédure dédiée |

Toute rotation définit : identifiant de clé, période de coexistence, validation ancienne et nouvelle, révocation d'urgence, audit, runbook.

**Perdre le pepper rend tous les mots de passe invérifiables.** C'est une donnée de sauvegarde critique, au même titre que la base elle-même.

---

## 10. Couverture OWASP

### ASVS niveau 2 — chapitres couverts

| Chapitre | Contrôle |
|---|---|
| V2.1 Politique de mot de passe | §1.1 — 12 caractères, aucune règle de composition |
| V2.2 Vérificateurs généraux | §1.4 — rate limiting, lockout, MFA |
| V2.4 Stockage | §1.1 — Argon2id + pepper |
| V2.5 Récupération | §1.2 — token 30 min, usage unique, réponse anti-énumération |
| V2.8 Vérificateurs à usage unique | §1.3 — TOTP RFC 6238 |
| V3.2 Liaison de session | §2 — session serveur, rotation |
| V3.3 Terminaison | §5.4, §5.5 — 12 déclencheurs de révocation |
| V3.4 Cookies | §2 — `HttpOnly`, `Secure`, `SameSite`, préfixes |
| V4.1 Conception d'accès | §6.1 — chaîne en 8 étapes, fail closed |
| V4.2 Contrôle au niveau opération | §6.4 — décorateur de permission |
| V4.3 Autres considérations | §6.5 — réauthentification |
| V13.2 REST | [`API_CONVENTIONS.md`](../api/API_CONVENTIONS.md) |
| V14.4 En-têtes HTTP | §4 |
| V14.5 Validation des requêtes | §3.5 — Origin, CORS |

### API Security Top 10 (2023)

| Risque | Contrôle |
|---|---|
| API1 BOLA | étapes 7-8 + garde Prisma ([ADR-0003](../adr/0003-tenant-isolation-strategy.md)) |
| API2 Broken Authentication | §5 — rotation, détection de rejeu, MFA |
| API3 BOPLA | DTO en liste blanche, `class-validator` `forbidNonWhitelisted`, présenteurs de sortie explicites |
| API4 Consommation non maîtrisée | [`RATE_LIMITING_AND_ABUSE_PREVENTION.md`](RATE_LIMITING_AND_ABUSE_PREVENTION.md) |
| API5 BFLA | §6.2 — portées, `SCANNER` limité à l'événement |
| API6 Flux métier sensibles | idempotence + anti-rejeu QR |
| API7 SSRF | aucune URL fournie par l'utilisateur n'est appelée ; toute intégration future passe par une liste blanche |
| API8 Mauvaise configuration | §4 — en-têtes explicites, validation d'environnement bloquante au démarrage |
| API9 Inventaire | OpenAPI 3.1 généré, versionné, validé en CI |
| API10 Consommation d'API non sûre | aucune API tierce au MVP |

---

## 11. Tests de sécurité obligatoires

Aucune feature d'authentification n'est `DONE` sans ces tests **négatifs**. Le dépôt contient aujourd'hui 31 `it.todo` et 2 assertions réelles ; ce sont ces cas qui doivent les remplacer.

| # | Test | Attendu |
|---|---|---|
| 1 | Login avec un compte inexistant | même durée et même corps qu'un mot de passe faux |
| 2 | 6 logins échoués (même ip+email) | `429` au 6ᵉ, jamais `AUTH_ACCOUNT_LOCKED` renvoyé |
| 3 | Un attaquant échoue sur l'email d'une victime | la victime se connecte encore depuis sa propre IP |
| 4 | Rejeu d'un refresh consommé | famille révoquée, session `COMPROMISED`, aucun token émis |
| 5 | Deux rotations concurrentes, même token | exactement un succès |
| 6 | `POST` sans `X-CSRF-Token` | `403 AUTH_CSRF_INVALID` |
| 7 | Token CSRF d'un autre contexte | `403` |
| 8 | Token CSRF pré-session réutilisé après login | `403` |
| 9 | `Origin` non autorisé | `403 AUTH_ORIGIN_DENIED` |
| 10 | ID de ressource valide d'un autre tenant | `403 AUTH_TENANT_DENIED`, jamais `200` |
| 11 | Rôle révoqué, access token encore valide | `403` immédiat |
| 12 | Session révoquée, access token encore valide | `401` |
| 13 | Token `alg: none` ou `HS256` | rejeté |
| 14 | Token signé avec un `kid` retiré | rejeté |
| 15 | Session au-delà de `absolute_expires_at` | `401` malgré une activité continue |
| 16 | Scanner de l'événement A scanne l'événement B (même organisation) | `403` |
| 17 | Appareil révoqué | `403`, sessions coupées |
| 18 | Organisation suspendue | toutes les routes métier refusées |
| 19 | Mass assignment (`status`, `organizationId` dans le corps) | champs ignorés ou `400` |
| 20 | Escalade — assigner un rôle `PLATFORM` via l'API d'organisation | refusé applicativement **et** par trigger |
| 21 | Révoquer le dernier `SUPER_ADMIN` | refusé |
| 22 | Assigner `SUPER_ADMIN` sans MFA actif | refusé |
| 23 | Double check-in du même ticket | un seul `ACCEPTED`, le second `DUPLICATE` |
| 24 | Rejeu de QR au-delà de 90 s | refusé, `TICKET_REPLAY_DETECTED` |
| 25 | Même `Idempotency-Key`, corps différent | `409 IDEMPOTENCY_CONFLICT` |
