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

> ✅ **Fait le 1er août 2026.** Migrations 4, 5 et 6 appliquées sur base vierge — 21 tables, 13 triggers. **INV-02, INV-11 et INV-12 passent de « reporté » à « appliqué »**, et le registre d'EVT-019 a signalé lui-même le moment où c'est devenu possible. `prisma migrate diff --exit-code` reste à **0**.

### Structure livrée

```
prisma/migrations/
├── 20260801090000_invitations_and_email_verification/   migration 4
├── 20260801091000_sessions_and_rotations/               migration 5
└── 20260801092000_password_reset_and_mfa/               migration 6
```

7 nouveaux modèles Prisma, 9 nouveaux ensembles de statuts dans `enums.ts`, et le registre de propriété tenant étendu aux 7.

### Le registre d'invariants a fait exactement ce pour quoi il a été écrit

EVT-019 refusait d'écrire `it.todo` pour les invariants non testables et affirmait à la place que leurs tables étaient **encore absentes**. À l'apparition de `user_sessions` et `mfa_methods`, trois tests ont échoué en nommant **INV-02, INV-11, INV-12** et le ticket EVT-021. Le report a expiré tout seul.

Le contrôle d'exhaustivité de la propriété tenant a fait de même : les 7 nouveaux modèles ont échoué à la classification avant d'atteindre l'exécution.

### 🔴 INV-11 n'est applicable que si l'utilisateur est `ACTIVE` — arbitrage dérivé

Le §9 énonce l'invariant sans condition : « tout utilisateur portant `SUPER_ADMIN` possède au moins une `mfa_methods` de statut `ACTIVE` ». Appliqué littéralement, il **rend impossible la procédure d'amorçage** du [`MIGRATION_STRATEGY.md` §8.2](../../database/MIGRATION_STRATEGY.md), qui crée l'administrateur plateforme en `PENDING`, **avec l'attribution déjà en place** et sans MFA, et ne passe à `ACTIVE` qu'après enrôlement.

Deux documents du corpus se contredisent donc. La qualification retenue — n'appliquer qu'à partir de `users.status = 'ACTIVE'` — ne coûte rien : un utilisateur `PENDING` ne peut pas s'authentifier, donc ne peut pas se servir de l'attribution. Ce qui compte est que personne ne puisse **utiliser** `SUPER_ADMIN` sans MFA.

**Deux triggers, pas un**, parce qu'il y a deux chemins d'entrée :

| Chemin | Trigger |
|---|---|
| accorder le rôle à un utilisateur actif | `trg_super_admin_mfa_on_grant` sur `platform_role_assignments` |
| activer un utilisateur qui détient déjà le rôle | `trg_super_admin_mfa_on_activation` sur `users` |

Ne garder que le premier laisserait le second comme contournement en deux étapes.

### La colonne qu'EVT-018 avait reportée ici

`membership_role_assignments.organization_id` est ajoutée par la migration 4, en **expand / backfill / contract** : ajouter directement une colonne `NOT NULL` échoue sur toute base qui a déjà des lignes, et l'intérêt de la séquence est précisément de ne pas dépendre du fait que la table est vide.

Conséquence : la catégorie `ORGANIZATION_OWNED_VIA_RELATION` et le chemin de jointure de l'analyseur de scope sont **supprimés**, pas laissés inertes. Ils n'existaient que pour contourner l'absence de la colonne. Un chemin de code mort qui affaiblit le contrat de la garde — accepter un filtre de relation — est pire que pas de chemin du tout.

### Ce que les migrations ajoutent au-delà de ce que Prisma génère

| | |
|---|---|
| `ck_sessions_tenant_coherence` | **INV-12**, résout C-29 |
| `ck_sessions_expiry_order` | une session qui expire par inactivité **après** son expiration absolue rend cette dernière décorative |
| `ux_refresh_active_per_family` | **AUTH-INV-003**, résout C-27. C'est cet index qui départage deux rotations concurrentes — un verrou Redis coordonne, l'index garantit |
| `ux_mfa_user_type_pending` / `ux_mfa_user_type_active` | C-28 : l'index combiné du Document A **empêchait tout ré-enrôlement** tant qu'une méthode active existait |
| `trg_session_membership_coherence` | **INV-02** — chaque décision d'autorisation en aval lit `user_id` et `organization_id` de la session |
| `trg_rotations_append_only` | la chaîne de rotation **est** la piste d'audit de la session. `DELETE` refusé ; `UPDATE` autorisé sur les statuts, refusé sur le token, la session, la famille et `issued_at` |

`user_sessions.device_id` est créée **sans** clé étrangère : `scanner_devices` arrive avec la migration 7 (EVT-045). La contrainte y sera ajoutée.

### Deux constats en exécutant

- **INV-02 se déclenche avant `ck_sessions_tenant_coherence`** sur « membership sans organisation » : le trigger `BEFORE INSERT` a un membership à comparer, donc il refuse en premier. Les deux interdisent la forme ; le test assertait un nom de contrainte, ce qui n'assertait que l'ordre de déclenchement. L'autre direction — organisation sans membership — atteint bien le `CHECK`, donc les deux sont prouvés.
- **`BOOTSTRAP_SUPER_ADMIN_EMAIL=` (vide) fait échouer le démarrage** avec « Invalid email address », alors que le seed traite une chaîne vide comme absente. Une variable d'environnement vide se lit conventionnellement comme non définie ; les deux couches ne sont pas d'accord. Constaté en montant une base identique à celle de la CI. Hors périmètre de ce ticket — signalé pour le schéma d'environnement (EVT-008).

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

> ✅ **Fait le 1er août 2026.** Signature EdDSA via `jose`, `kid` en en-tête, fenêtre de coexistence. **Les 5 attaques obligatoires sont refusées et testées**, dont la confusion d'algorithme. `@nestjs/jwt`, `passport`, `passport-jwt` et `@nestjs/passport` sont retirés.

### Structure livrée — un fichier, une responsabilité

```
infrastructure/jwt/
├── jose.ts                    le seul endroit où `jose` est chargé
├── access-token.claims.ts     le jeu de claims d'ADR-0005, et rien d'autre
├── access-token.errors.ts     AccessTokenError + motif interne
├── signing-keys.ts            une clé de signature, N clés de vérification
├── token-audience.ts          audience dérivée du type de client
├── access-token.lifetime.ts   la matrice de durées d'ADR-0009
├── access-token.signer.ts     issue()
└── access-token.verifier.ts   verify()
```

### La ligne qui bloque la confusion d'algorithme

```ts
const ALLOWED_ALGORITHMS = ['EdDSA'];   // passé à jwtVerify, jamais lu de l'en-tête
```

La clé publique Ed25519 n'est **pas** un secret. Un vérificateur qui ferait confiance au champ `alg` de l'en-tête traiterait volontiers cette clé publique comme un secret HMAC et accepterait tout ce que l'attaquant signerait avec. Vérifié : `HS256` signé avec la clé publique est refusé, `alg: none` aussi.

Le `kid` est résolu **avant** toute cryptographie, contre un ensemble fixe. Un `kid` inconnu n'atteint jamais la vérification de signature — et c'est aussi ce qui rend la révocation d'urgence immédiate : retirer une clé de l'ensemble tue tous ses tokens sur-le-champ.

### Ce que le token ne peut pas contenir, structurellement

Le signataire ne fait **jamais** de spread d'un objet fourni par l'appelant : il construit la charge utile à partir d'`AccessTokenClaims`. Un mot de passe, un secret MFA, un refresh token ou une liste de permissions ne peut pas fuiter dans un token qui n'a aucun moyen de porter une clé imprévue. Un test asserte que l'ensemble des clés de la charge utile est **exactement** `sub, sid, org, mbr, ver, ct, al` + `iat, exp, iss, aud`.

### 🔴 `jose` 6 est ESM-only, et Jest ne peut pas le charger statiquement

Node 24 sait faire `require()` d'un module ESM, donc un `import` statique **compile et fonctionne** en production. Mais Jest remplace `require` : il passe la source ESM à son compilateur CommonJS, qui échoue sur `export`. Le problème serait apparu en CI, pas en local.

`jose.ts` fait donc un `import()` dynamique mémoïsé — TypeScript le préserve tel quel en sortie CommonJS avec `module: nodenext`, et les scripts de test tournent déjà avec `--experimental-vm-modules` pour le compilateur WASM de Prisma. Un seul fichier connaît cette contrainte.

### Deux vérifications que le corpus n'imposait pas

- **`typ: 'JWT'`** est exigé à la vérification, pas seulement posé à la signature.
- **Chaque claim est validé, jamais casté.** La chaîne d'autorisation lit `ver`, `sid` et `org` pour décider ; un claim absent doit être un refus, pas un `undefined` comparé à quelque chose. Un token valablement signé mais amputé d'un claim est rejeté — testé pour les cinq claims obligatoires.
- **`ACCESS_TOKEN_PREVIOUS_KEY_ID` égal à `ACCESS_TOKEN_KEY_ID`** fait échouer le démarrage. Sinon la table de clés contiendrait une seule entrée, l'ancienne clé ne serait acceptée nulle part, et la fenêtre de coexistence serait silencieusement annulée au moment du déploiement.

### Le motif de refus ne sort jamais du serveur

`AccessTokenError` porte un motif interne (`UNKNOWN_KEY`, `BAD_SIGNATURE`, `BAD_AUDIENCE`…). L'appelant reçoit toujours un seul `401 AUTHENTICATION_REQUIRED` : lui dire que la signature était bonne mais l'audience mauvaise, c'est lui dire que sa contrefaçon est à un champ de fonctionner.

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

> ✅ **Fait le 1er août 2026.** `POST /api/v1/auth/sessions` fonctionne de bout en bout contre PostgreSQL réel : 20 tests e2e, dont l'indiscernabilité des refus et l'écriture atomique session + refresh token. **4 étapes sur 20 sont reportées** aux tickets qui les possèdent, listées ci-dessous.

### Structure livrée

```
sessions/domain/
├── refresh-token.ts        32 octets opaques, HMAC-SHA-256, comparaison à temps constant
├── session-profile.ts      profil (WEB/SCANNER × plateforme) → échéances
└── session.repository.ts   le port ; user_sessions est mixte, donc pas de TenantContext
authentication/
├── domain/organization-resolution.ts   l'étape 11, pure
├── domain/authentication.errors.ts     les motifs de refus, internes
├── domain/authentication.repository.ts une requête pour les étapes 6 à 13
├── application/login.use-case.ts       l'orchestration
├── dto/login.dto.ts                    whitelist stricte
└── infrastructure/cookies/session-cookies.ts
```

### Ce qui est livré, et les 4 étapes qui ne peuvent pas l'être

| Étapes | État |
|---|---|
| 1, 2, 6, 7, 8, 9, 11, 12, 13, 14, 15, 19, 20 | ✅ livrées |
| 3, 4 — rate limit et lockout | ⏳ **EVT-030**, qui dépend de Redis (EVT-029) |
| 5, 16 — CSRF pré-session et token CSRF | ⏳ **EVT-028** |
| 10 — porte MFA | ⏳ **EVT-027** |

Ces quatre tickets sont **postérieurs** à celui-ci dans le plan de sprint : les étapes ne sont pas oubliées, elles ne sont pas encore constructibles. Deux des trois cookies sont posés ; le troisième est celui du CSRF.

Conséquence assumée et rendue visible dans le code : **toute session naît en `authentication_level = 'PASSWORD'`**, jamais en `MFA`. Un test l'asserte même pour un utilisateur qui possède déjà une méthode MFA active, pour qu'aucun code écrit d'ici EVT-027 ne suppose l'inverse.

### 🔴 L'étape 7, et pourquoi l'ordre des vérifications compte

Sans vérification factice, le chemin « compte inconnu » saute Argon2id et répond un ordre de grandeur plus vite. C'est de l'énumération d'utilisateurs mesurable à distance. `verifyDecoy` (livré par EVT-020) est appelé sur ce chemin, et un test compare les deux durées.

Le même raisonnement dicte un ordre qu'on inverserait naturellement : **le statut de l'utilisateur est vérifié _après_ le hachage**, pas avant. Sortir tôt pour un compte suspendu le ferait répondre sans payer Argon2id — exactement la même fuite, par une autre porte. Un test mesure aussi ce chemin.

### 🔴 Une contradiction dans le §5.1, tranchée

L'étape 11 dit « aucun membership et pas de rôle ⇒ **403** ». Les tests négatifs du ticket disent « organisation `SUSPENDED` ⇒ **réponse générique** ». Ces deux phrases se contredisent pour l'utilisateur qui **a** un membership dont l'organisation est suspendue : c'est à la fois « aucune organisation utilisable » et « organisation suspendue ».

Arbitrage retenu — les deux cas sont distincts et le sont dans le type :

| Situation | Réponse |
|---|---|
| Des memberships, mais aucun utilisable | `401 AUTH_INVALID_CREDENTIALS`, générique |
| Aucun membership, aucun rôle plateforme | `403 AUTH_TENANT_DENIED` |

Dire à un appelant « votre organisation est suspendue » est un fait sur un compte qui n'est peut-être pas le sien. N'avoir aucun accès du tout n'apprend rien à personne.

### Aucune organisation n'est choisie à la place de l'utilisateur

Les organisations inutilisables sont filtrées **avant** le comptage : un utilisateur avec un membership vivant et un suspendu obtient une réponse définie plutôt qu'ambiguë. Avec plusieurs organisations utilisables, la session est créée **sans organisation active** et le client doit appeler l'activation. Choisir « la première » ferait atterrir la connexion dans un tenant que l'utilisateur n'a pas désigné, et tout ce qui suit y serait attribué.

### Deux défauts trouvés en exécutant

| Défaut | Correction |
|---|---|
| **`refresh_token_rotations` n'avait aucune échappatoire de rétention.** EVT-021 lui a donné un trigger `APPEND_ONLY` qui refusait `DELETE` sans condition, alors que le §2.5 la place dans le même régime que `security_events` et `audit_logs` — « purge par rétention uniquement » — et que ces deux-là portent l'échappatoire depuis la migration 8. Sans elle la table ne peut que croître, et elle gagne une ligne à **chaque** rafraîchissement | Migration 7 : `reject_rotation_rewrite` honore `SET LOCAL eventini.retention_purge` |
| **La règle 2 du test d'architecture a refusé mes deux nouveaux repositories.** Correct : ni l'un ni l'autre ne peut prendre un `TenantContext`. L'authentification s'exécute *avant* qu'un contexte tenant existe — le résoudre est précisément le travail du login — et `user_sessions` est de propriété mixte | Ajoutés à la liste d'exemptions, avec leur justification |

Un de mes propres tests était également faux : il affirmait qu'une organisation suspendue donnait `NO_ACCESS`, ce qui était l'arbitrage avant que la contradiction du §5.1 soit tranchée.

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
