# ADR-0005 — Signature des access tokens : EdDSA (Ed25519) via `jose`

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | comble un trou du Document B §17 |
| **Impacte** | émission et validation des access tokens, rotation des clés, futur client Flutter |

## Contexte

Le Document B §17 spécifie 10 claims et 9 validations, dont « algorithme explicite », mais **ne nomme jamais l'algorithme**, ni `iss`, ni `aud`. Le §40.3 exige une rotation de clés avec identifiant de clé et période de coexistence — ce qui est structurellement impossible à faire proprement avec un secret symétrique unique.

Le backend a **deux** bibliothèques installées et non utilisées : `jose ^6.2.4` et `@nestjs/jwt ^11.0.2`.

## Décision

**EdDSA (Ed25519) via `jose`.** `@nestjs/jwt` est retiré des dépendances (chemin redondant).

```
header  { "alg": "EdDSA", "kid": "ak_2026_07", "typ": "JWT" }

claims  sub  userId
        sid  sessionId                      ← clé de la vérification serveur
        org  organizationId | null          ← null pour les sessions PLATFORM
        mbr  membershipId  | null
        ver  users.version                  ← invalide le token si l'utilisateur change
        ct   clientType    WEB | MOBILE_SCANNER
        al   authLevel     PASSWORD | MFA | REAUTHENTICATED
        iat, exp
        iss  "https://api.eventini.com"
        aud  "eventini-web" | "eventini-scanner"
```

Interdits dans le token : mot de passe, hash, secret MFA, recovery codes, refresh token, PII non nécessaire, **liste de permissions** (voir [ADR-0004](0004-permission-resolution-and-caching.md)).

### Rotation

| Étape | Action |
|---|---|
| 1 | Générer la nouvelle paire, publier la clé publique sous un nouveau `kid` |
| 2 | Fenêtre de coexistence ≥ durée de vie du refresh token le plus long (30 j) : les deux `kid` sont acceptés en **vérification**, seul le nouveau est utilisé en **signature** |
| 3 | Retirer l'ancien `kid` de l'ensemble de vérification |
| 4 | Audit `SIGNING_KEY_ROTATED`, runbook associé |

Révocation d'urgence : retirer le `kid` compromis immédiatement, ce qui invalide tous les access tokens signés avec — les sessions restent valides et repartent d'un refresh.

Les 7 secrets distincts du Document B §40.2 sont conservés et ne sont **jamais** dérivés les uns des autres : signature access, CSRF, chiffrement MFA, HMAC refresh, invitation, reset de mot de passe, signature QR.

## Conséquences

**Positives** — seul le module d'authentification détient la clé privée ; la rotation avec `kid` est native ; un futur vérificateur (Flutter, service tiers, gateway) reçoit une clé publique et ne peut pas forger de token ; les signatures Ed25519 sont rapides et courtes.

**Négatives** — deux clés à gérer au lieu d'un secret ; la clé publique doit être distribuée (variable d'environnement au départ, JWKS si le besoin apparaît) ; `@nestjs/jwt` doit être retiré, ce qui est une modification de `package.json` planifiée en sprint 02.

## Alternatives rejetées

- **HS256 via `@nestjs/jwt`** — le plus simple, un seul secret. Mais tout vérificateur est aussi signataire : le mobile ne peut jamais vérifier localement, et la rotation devient une bascule brutale sans fenêtre de coexistence.
- **ES256 (P-256)** — équivalent en propriétés, support plus large sur les vieilles bibliothèques. Retenu comme repli si un client cible s'avère incompatible avec Ed25519.

## Vérification

- Test unitaire : un token signé avec un `kid` retiré est rejeté.
- Test unitaire : un token dont `alg` est `none` ou `HS256` est rejeté (attaque par confusion d'algorithme) — l'algorithme attendu est passé explicitement à `jwtVerify`.
