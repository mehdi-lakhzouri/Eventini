# ADR-0009 — Durées de vie des tokens et des sessions

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | comble un trou du Document B §14, §17, §18 |
| **Impacte** | cookies, `user_sessions.idle_expires_at` / `absolute_expires_at`, tous les tokens à usage unique |

## Contexte

Le Document B §14 donne des **plages**, pas des valeurs : access « 5 à 15 minutes », refresh « 7 à 30 jours ». Les colonnes `idle_expires_at` et `absolute_expires_at` existent dans le Document A §6.12 sans aucune valeur associée. Aucune durée n'existe pour le token de reset, la vérification d'email, l'invitation, le challenge MFA, la preuve de réauthentification ou le token CSRF.

Les profils de menace sont réellement différents : un scanner mobile doit survivre à un événement de plusieurs jours avec une connectivité dégradée ; un navigateur d'administrateur ne doit pas.

## Décision

**Durées différenciées par `clientType` et par niveau de privilège.**

| Profil | access | refresh | idle | absolue |
|---|---|---|---|---|
| `WEB` / `CLIENT_ADMIN` | 10 min | 14 j | 12 h | 30 j |
| `WEB` / `SUPER_ADMIN` | 5 min | 1 j | 30 min | 7 j |
| `MOBILE_SCANNER` | 15 min | 30 j | 7 j | 90 j |

**Sémantique** — `idle_expires_at` est repoussé à chaque rotation de refresh. `absolute_expires_at` est fixé à la création de la session et **jamais** prolongé : au bout de la durée absolue, une réauthentification complète est exigée quelle que soit l'activité.

### Tokens à usage unique

| Token | Durée | Notes |
|---|---|---|
| Reset de mot de passe | 30 min | usage unique, toute nouvelle demande remplace la précédente (`REPLACED`) |
| Vérification d'email | 24 h | |
| Invitation | 7 j | renouvelable par un acteur autorisé, l'ancienne passe `REPLACED` |
| Challenge MFA | 5 min | 5 tentatives maximum, puis le challenge est détruit |
| Preuve de réauthentification | 10 min | liée à la session, non transférable |
| Token CSRF | durée de la session | régénéré à chaque rotation de refresh |

### Nonce anti-rejeu et idempotence

| Élément | Durée |
|---|---|
| Nonce anti-rejeu QR | 90 s |
| Enregistrement d'idempotence — nominal | 24 h |
| Enregistrement d'idempotence — synchronisation attendance | 7 j |

7 jours pour la synchronisation offline parce qu'un scanner peut rester déconnecté toute la durée d'un événement : 24 h transformerait un rejeu légitime en double check-in.

### Marge d'horloge

Tolérance de validation `exp` / `iat` : **30 secondes**. Au-delà, le token est rejeté.

## Conséquences

**Positives** — le compromis sécurité/ergonomie est fait par profil et non globalement ; `SUPER_ADMIN` est réellement renforcé comme l'exige le Document B ; le scanner reste utilisable sur un événement long sans affaiblir le web.

**Négatives** — trois profils à tester au lieu d'un ; la table des durées devient de la configuration qui doit être validée au démarrage (une valeur absente ou incohérente doit être une erreur `fatal`, pas un défaut silencieux) ; un `CLIENT_ADMIN` promu `SUPER_ADMIN` doit voir sa session existante rétrogradée en durée — traité par une révocation de session au changement de rôle, déjà exigée par le Document B §25.3.

## Alternatives rejetées

- **Profil uniforme** — bien plus simple à documenter et tester, mais impose une règle séparée de validité du snapshot offline pour le scanner, ce qui réintroduit la complexité ailleurs et de façon moins visible.
- **Strict partout** (5 min / 7 j / 30 min / 7 j) — sécurité maximale, mais un opérateur de scan en milieu de journée avec une connectivité instable serait déconnecté en permanence.

## Vérification

- Test d'intégration : une session inactive au-delà de `idle_expires_at` est refusée même avec un refresh token valide.
- Test d'intégration : une session au-delà de `absolute_expires_at` est refusée même active en continu.
- Validation d'environnement : toute durée manquante fait échouer le démarrage.
