# Sprint 04 — Authentification cœur

> [← Sprint 03](../sprint-03/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 05 →](../sprint-05/README.md)

| | |
|---|---|
| **Tickets** | EVT-020 → EVT-027 |
| **Prérequis** | Sprint 03 |
| **Migrations** | **4, 5, 6** |
| **Jalon** | — |

---

## Objectif

Login, rotation des refresh tokens, détection de rejeu, MFA, gestion des mots de passe.

C'est le sprint où les invariants `AUTH-INV-001` à `AUTH-INV-012` du Document B deviennent du code.

## Critère de sortie

- login, rotation et déconnexion fonctionnent de bout en bout ;
- **le rejeu d'un refresh token révoque la famille entière** ;
- deux rotations concurrentes avec le même token : **exactement un succès**.

---

## Tickets

| # | Titre | Migration |
|---|---|---|
| [EVT-020](#evt-020) | Hachage Argon2id | — |
| [EVT-021](#evt-021) | Migrations sessions, mots de passe, MFA | 4, 5, 6 |
| [EVT-022](#evt-022) | Émission et vérification des access tokens | — |
| [EVT-023](#evt-023) | Login | — |
| [EVT-024](#evt-024) | Rotation et détection de rejeu | — |
| [EVT-025](#evt-025) | Déconnexion et révocation | — |
| [EVT-026](#evt-026) | Reset de mot de passe et vérification d'email | — |
| [EVT-027](#evt-027) | MFA TOTP | — |

---

## EVT-020 — Hachage Argon2id
<a id="evt-020"></a>

> ✅ **Fait le 1er août 2026.** `ArgonPasswordHasher` implémente le profil ADR-0007 avec le pepper natif. 33 tests, dont le rehash sur dérive des **quatre** paramètres et le budget de 150 ms.

### Structure livrée

```
domain/password.policy.ts        NFKC + bornes, aucun framework
domain/password-hasher.ts        le port : hash / verify / verifyDecoy
infrastructure/argon2-profile.ts options, version de profil, détection de dérive
infrastructure/argon-password-hasher.ts
```

### Trois comportements d'`argon2@0.45.1` vérifiés, pas supposés

| Constat | Conséquence |
|---|---|
| `needsRehash` compare `m`, `t` et `p` — **pas la longueur du hash** | `isStaleHash` décode le dernier segment base64 et compare les octets, sinon un digest raccourci ne serait jamais remonté |
| Un digest malformé fait **lever** `verify`, il ne renvoie pas `false` | Une ligne corrompue deviendrait un 500 ; elle est traitée comme « mot de passe invalide » |
| `verify` sans le pepper renvoie **`false`**, sans erreur | Un pepper mal configuré ressemblerait à « tous les mots de passe sont faux ». La règle `secret-hygiene` du sprint 02 le valide déjà (base64, ≥ 32 octets, distinct des 6 autres secrets) |

### Détails d'implémentation

- **Longueur en points de code**, pas en unités UTF-16 : `[...normalized].length`. Sinon 6 emoji passeraient pour 12 caractères.
- **Mesurée après NFKC** : la normalisation peut allonger la chaîne (`ﬁ` → `fi`).
- **`verifyDecoy`** — un digest construit une fois à partir d'un mot de passe que personne ne détient, réutilisé à chaque tentative. C'est la primitive de l'étape 7 d'EVT-023 ; la fournir ici la rend difficile à oublier là-bas.

```
Branche  feat/EVT-020-argon2-hasher
Commit   feat(identity): implement Argon2id password hashing with pepper
Tables   user_credentials
```

**État actuel** — `ArgonPasswordHasher` existe comme `export class ArgonPasswordHasher {}`. Le paquet `argon2` est installé et **jamais importé**.

```ts
argon2.hash(password, {
  type: argon2.argon2id,
  memoryCost:  19456,   // KiB = 19 MiB
  timeCost:    2,
  parallelism: 1,
  hashLength:  32,
  secret: Buffer.from(env.PASSWORD_PEPPER, 'base64'),   // 32 octets
})
```

**Le pepper utilise l'option native `secret`** — pas un HMAC préalable, pas un second niveau de hachage. Il est stocké hors PostgreSQL : un dump de base seul ne permet pas de casser les mots de passe hors ligne.

**Politique** — 12 à 128 caractères, **aucune règle de composition** (ASVS V2.1.9), normalisation NFKC, espaces conservés.

**Tests**

- les paramètres effectifs sont lisibles dans le hash encodé : `$argon2id$v=19$m=19456,p=1,t=2$…` ;
- un hash produit avec d'anciens paramètres est **re-haché à la vérification** et `password_version` incrémenté ;
- benchmark CI : la vérification reste sous 150 ms — garde-fou contre une régression de paramètre.

> 🔧 **Correction d'ordre.** Ce document annonçait `m=19456,t=2,p=1`. `argon2@0.45.1` sérialise en réalité **`m,p,t`** — constaté en lisant un digest produit, pas supposé. Une assertion écrite sur l'ordre annoncé aurait échoué sans que rien ne soit cassé.

> 🔴 **`PASSWORD_PEPPER` est une donnée de sauvegarde critique.** Le perdre rend **tous** les mots de passe invérifiables : aucun utilisateur ne peut plus se connecter, et aucune restauration de base n'y remédie. À sauvegarder au même titre que la base, et **séparément d'elle**.

---

## EVT-021 — Migrations sessions, mots de passe, MFA
<a id="evt-021"></a>

```
Branche  feat/EVT-021-session-schema
Commit   feat(db): add sessions, rotations, password and MFA tables
Tables   user_invitations, email_verification_tokens          (migration 4)
         user_sessions, refresh_token_rotations                (migration 5)
         password_reset_tokens, mfa_methods, mfa_recovery_codes (migration 6)
```

### Quatre corrections au Document A

| # | Correction | Pourquoi |
|---|---|---|
| **C-1** | **Aucune** colonne `current_refresh_token_hash` sur `user_sessions` | deux dépôts = deux vérités pour l'invariant de rotation ([ADR-0014](../../adr/0014-refresh-token-hash-single-store.md)) |
| **C-27** | `ux_refresh_active_per_family(token_family_id) WHERE status='ACTIVE'` **ajouté** | le Document A affirmait « un seul token ACTIVE par famille » **sans l'indexer**. C'est cet index qui rend deux rotations concurrentes mutuellement exclusives |
| **C-28** | Index MFA **scindé** en `ux_mfa_user_type_pending` et `ux_mfa_user_type_active` | l'index combiné `WHERE status IN ('PENDING','ACTIVE')` **rendait tout ré-enrôlement impossible** tant qu'une méthode active existait |
| **C-29** | `ck_sessions_tenant_coherence` ajouté | les colonnes étaient nullables et déclarées « cohérentes » sans définir le cas plateforme |

```sql
CONSTRAINT ck_sessions_tenant_coherence CHECK (
  (organization_id IS NULL     AND active_membership_id IS NULL) OR
  (organization_id IS NOT NULL AND active_membership_id IS NOT NULL)
)
```

---

## EVT-022 — Émission et vérification des access tokens
<a id="evt-022"></a>

```
Branche  feat/EVT-022-access-tokens
Commit   feat(identity): issue and verify EdDSA access tokens with key rotation
```

**Décision** — EdDSA (Ed25519) via `jose`, en-tête `kid`, fenêtre de coexistence ([ADR-0005](../../adr/0005-token-signing-eddsa.md)).

**Dépendances à retirer** — `@nestjs/jwt`, `passport`, `passport-jwt`. Toutes installées, aucune utilisée, aucune strategy n'existe. `jose` + un guard suffisent.

```
header { "alg": "EdDSA", "kid": "ak_2026_07", "typ": "JWT" }
claims  sub, sid, org, mbr, ver, ct, al, iat, exp, iss, aud
```

**Interdits dans le token** — mot de passe, hash, secret MFA, recovery codes, refresh token, PII non nécessaire, **liste de permissions**.

**Tests négatifs obligatoires**

| Attaque | Attendu |
|---|---|
| `alg: none` | rejeté |
| `alg: HS256` signé avec la clé publique | rejeté — **confusion d'algorithme** |
| `kid` retiré de l'ensemble de vérification | rejeté |
| `iss` ou `aud` incorrect | rejeté |
| `exp` dépassé de plus de 30 s | rejeté |

L'algorithme attendu est passé **explicitement** à `jwtVerify` — jamais lu depuis l'en-tête du token. C'est ce qui bloque la confusion d'algorithme.

---

## EVT-023 — Login
<a id="evt-023"></a>

```
Branche  feat/EVT-023-login
Commit   feat(identity): implement login with generic errors and MFA gating
Routes   POST /api/v1/auth/sessions
Tables   user_sessions, refresh_token_rotations, security_events
```

**Scope** — les 20 étapes de [`AUTHENTICATION_AUTHORIZATION.md` §5.1](../../security/AUTHENTICATION_AUTHORIZATION.md).

### Les deux étapes qu'on oublie

**Étape 7 — vérifier Argon2id même si l'utilisateur n'existe pas.** Contre un hash factice. Sans cela, l'écart de temps de réponse entre « compte inconnu » (rapide) et « mot de passe faux » (60 ms d'Argon2id) révèle l'existence du compte. C'est de l'énumération d'utilisateurs par canal auxiliaire, et elle est mesurable à distance.

**Étape 11 — l'utilisateur membre de plusieurs organisations.** Le Document B ignorait ce cas. Résolution :

| Situation | Résultat |
|---|---|
| Un seul membership `ACTIVE` | celui-là devient l'organisation active |
| Plusieurs | session **sans organisation active** ; le client doit appeler `POST /organizations/{id}/activation` |
| Aucun, mais rôle plateforme | session `PLATFORM` (`organization_id IS NULL`) |
| Aucun et pas de rôle | `403` |

**Aucune organisation n'est choisie à la place de l'utilisateur.**

**Tests négatifs obligatoires**

- compte inexistant et mot de passe faux : **indiscernables** en corps **et en durée** ;
- utilisateur `SUSPENDED` ⇒ réponse générique `AUTH_INVALID_CREDENTIALS` ;
- organisation `SUSPENDED` ⇒ réponse générique ;
- compte verrouillé ⇒ réponse générique, **jamais** `AUTH_ACCOUNT_LOCKED`.

---

## EVT-024 — Rotation et détection de rejeu
<a id="evt-024"></a>

```
Branche  feat/EVT-024-refresh-token-rotation
Commit   feat(identity): rotate refresh tokens with reuse detection
Routes   POST /api/v1/auth/sessions/current/rotation
Tables   refresh_token_rotations, user_sessions, security_events
Sécurité AUTH-INV-003, AUTH-INV-009 · REFRESH_TOKEN_REUSE_DETECTED (CRITICAL)
```

**C'est le ticket le plus délicat du sprint.**

### Concurrence

Deux rotations simultanées avec le même token sont départagées par **`ux_refresh_active_per_family`**, pas par un verrou applicatif. La seconde viole l'index unique et échoue.

> Un verrou Redis ne remplace **jamais** une contrainte PostgreSQL. Le verrou coordonne ; la contrainte garantit.

### Détection de rejeu — la famille entière tombe

```
1  ligne → REUSED, reuse_detected_at
2  TOUTE la famille token_family_id → REVOKED
3  session → COMPROMISED puis REVOKED
4  invalider le cache Redis de la session
5  supprimer les cookies web
6  security event REFRESH_TOKEN_REUSE_DETECTED, sévérité CRITICAL
7  alerte immédiate
8  aucun nouveau token n'est émis
```

**Pourquoi toute la famille et pas seulement le token rejoué** — on ne sait pas lequel des deux porteurs est légitime. L'attaquant et la victime détiennent tous deux un token valide de la même famille. Les deux perdent l'accès ; la victime se reconnecte, l'attaquant ne peut pas.

**Tests négatifs obligatoires**

| Test | Attendu |
|---|---|
| Rejeu d'un token `CONSUMED` | famille **entière** révoquée, session `COMPROMISED`, **aucun token émis** |
| Deux rotations concurrentes, même token | exactement **un** succès |
| Session au-delà de `absolute_expires_at` | `401` malgré une activité continue |
| Session au-delà de `idle_expires_at` | `401` malgré un refresh token valide |

`absolute_expires_at` n'est **jamais** prolongé par une rotation. `idle_expires_at` l'est.

---

## EVT-025 — Déconnexion et révocation
<a id="evt-025"></a>

```
Branche  feat/EVT-025-logout-revocation
Routes   DELETE /auth/sessions/current   ·  DELETE /auth/sessions
         DELETE /auth/sessions/{sessionId} · GET /auth/sessions · GET /auth/me
```

| Opération | Effet |
|---|---|
| Déconnexion | session `REVOKED`, famille révoquée, cache invalidé, **3 cookies supprimés**, audit |
| Déconnexion globale | toutes les sessions `ACTIVE` révoquées, **`users.version` incrémenté**, `ALL_SESSIONS_REVOKED` |
| Révocation ciblée | vérifie d'abord que la session **appartient à l'appelant** |

L'incrément de `users.version` invalide **immédiatement** tous les access tokens en circulation, sans attendre leur expiration : le claim `ver` ne correspond plus (étape 3 de la chaîne d'autorisation).

**Suppression de cookie** — rejouer nom, `Path`, `Domain`, `SameSite`, `Secure` **et `HttpOnly`**. Le Document B §14.4 omettait `HttpOnly` (**C-19**) ; certains navigateurs ne reconnaissent alors pas le cookie à supprimer.

---

## EVT-026 — Reset de mot de passe et vérification d'email
<a id="evt-026"></a>

```
Branche  feat/EVT-026-password-reset
Routes   POST /auth/password-reset-requests · POST /auth/password-resets
         PUT  /auth/password
```

**Anti-énumération** — `202` retourné **systématiquement**, y compris pour un email inconnu. Le corps et la durée sont identiques dans les deux cas.

**Règles**

- token 30 min, usage unique, haché (jamais stocké en clair) ;
- toute nouvelle demande passe les `PENDING` du même utilisateur en `REPLACED` ;
- après reset : **révocation de toutes les sessions**, incrément de `users.version`, audit, notification ;
- changement de mot de passe : exige le mot de passe courant **ou** une réauthentification, révoque les **autres** sessions par défaut.

---

## EVT-027 — MFA TOTP
<a id="evt-027"></a>

```
Branche  feat/EVT-027-mfa-totp
Routes   POST   /auth/mfa/enrollments
         POST   /auth/mfa/enrollments/{id}/confirmation
         POST   /auth/mfa/challenges/{id}/verification
         DELETE /auth/mfa/methods/{id}
         POST   /auth/mfa/recovery-codes
```

**État actuel** — `otplib` est installé et **jamais importé**. Les 5 use cases MFA sont des classes vides.

```
algorithme  SHA-1        (RFC 6238 ; SHA-256 casse des applications d'authentification)
chiffres    6
période     30 s
dérive      ±1 fenêtre
secret      160 bits, CHIFFRÉ au repos (AES-256-GCM), jamais haché
recovery    10 codes, 10 caractères Crockford base32 (sans I, L, O, U), SHA-256
```

Le secret TOTP est **chiffré, pas haché** : il doit être relu pour vérifier un code. C'est la seule donnée secrète du système dans ce cas.

**Règles**

- MFA **obligatoire** pour `SUPER_ADMIN` (INV-11) : l'assignation du rôle est refusée sans méthode `ACTIVE` ;
- le secret n'est **jamais** retourné après confirmation, jamais journalisé ;
- recovery codes affichés **une seule fois**, régénérés par **lot atomique** — l'ancien lot entier est révoqué dans la même transaction ;
- challenge : 5 min, **5 tentatives**, puis détruit ;
- **aucun access token complet n'est émis avant le succès du MFA**.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| Vérification Argon2id sautée quand l'utilisateur n'existe pas | Test de timing statistique obligatoire (EVT-023) |
| Rotation protégée par un verrou applicatif au lieu de l'index | `ux_refresh_active_per_family` + test de concurrence |
| Seul le token rejoué révoqué, pas la famille | Test explicite dans EVT-024 |
| `absolute_expires_at` prolongé par erreur à la rotation | Test dédié |
| Message d'erreur trop précis « pour aider l'utilisateur » | Réponses génériques imposées, testées |
| `PASSWORD_PEPPER` non sauvegardé | Runbook + alerte ; documenté dans EVT-020 |
