# ADR-0013 — Baseline de rate limiting et de verrouillage de compte

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | comble un trou total — aucun nombre n'existait dans le corpus |
| **Impacte** | tous les endpoints, `security_events`, métriques, alertes |
| **OWASP** | ASVS V2.2 · API4 Unrestricted Resource Consumption |

## Contexte

Le Document B §33 liste 7 dimensions et 7 endpoints prioritaires. Le Document C §21 décrit les algorithmes, la hiérarchie et le contrat `429`. **Aucun des deux ne donne un seul nombre.** Le seul artefact concret du corpus entier est un nom de politique dans un exemple de log : `LOGIN_BY_IP_AND_EMAIL`.

Il n'existe aujourd'hui aucun rate limiting dans le dépôt.

Contrainte métier particulière : les administrateurs d'un événement se connectent souvent **depuis le lieu de l'événement**, donc derrière un NAT partagé. Une limite trop stricte par IP bloquerait une équipe entière.

## Décision

**Limites en couches, la plus restrictive gagne. Lockout sur le couple `ip+email`, jamais sur l'email seul.**

### Couche globale

| Dimension | Limite |
|---|---|
| Par IP, toutes routes | 300 req / min |
| Par utilisateur authentifié | 1 000 req / min |
| Par organisation | 5 000 req / min |

### Endpoints sensibles

| Endpoint | Limite | Clé |
|---|---|---|
| `POST /auth/sessions` (login) | 5 / 15 min | `ip+email` |
| `POST /auth/sessions` (login) | 20 / 15 min | `ip` |
| `POST /auth/mfa/challenges/{id}/verification` | 5 / 5 min | `challengeId` |
| `POST /auth/sessions/current/rotation` | 30 / h | `sessionId` |
| `POST /auth/password-reset-requests` | 3 / h | `email` |
| `POST /auth/password-reset-requests` | 10 / h | `ip` |
| `POST /auth/password-resets` | 5 / h | `ip` |
| `POST /auth/invitation-acceptances` | 10 / h | `ip` |
| `POST /attendance/check-ins` | 600 / min | `deviceId` |
| `POST /participants/imports` | 5 / h | `organizationId` |

600/min pour le scan : un opérateur rapide fait environ 20 scans/minute ; la marge absorbe les rafales de synchronisation offline sans laisser passer un script.

### Échelle de verrouillage — clé `ip+email`

| Échecs consécutifs | Verrou |
|---|---|
| 5 | 15 min |
| 10 | 1 h |
| 15 | 24 h |

**Le compteur par email seul ne verrouille jamais.** Il déclenche uniquement une élévation d'exigence (challenge supplémentaire) et un security event `ACCOUNT_LOCKED` à visée d'alerte. C'est délibéré : verrouiller sur l'email seul permettrait à un attaquant de bloquer n'importe quel utilisateur en devinant son adresse — un déni de service contre la victime déguisé en mesure de sécurité.

Une authentification réussie remet le compteur `ip+email` à zéro.

### Réponses

Toujours **génériques** : `AUTH_INVALID_CREDENTIALS` que le compte existe, n'existe pas, soit verrouillé ou suspendu. Le verrouillage n'est **jamais** annoncé au client. Il est visible dans `security_events`, pas dans la réponse HTTP.

`429` porte `Retry-After`, `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset`, `error.code = RATE_LIMIT_EXCEEDED`, `retryable: true`. Un jitter est appliqué pour éviter les rafales synchronisées de réessais.

### Implémentation

Fenêtre glissante par sorted set Redis, en Lua — voir [ADR-0011](0011-redis-lua-atomic-operations.md). `@nestjs/throttler` **n'est pas utilisé** : il ne couvre pas le multi-dimension ni le lockout progressif.

## Conséquences

**Positives** — un attaquant ne peut pas verrouiller une victime ; les équipes derrière un NAT partagé ne se bloquent pas mutuellement (la clé `ip+email` isole les comptes) ; le check-in reste utilisable en rafale ; toutes les décisions sont traçables et alertables.

**Négatives** — un attaquant disposant de nombreuses IP contourne la clé `ip+email` ; c'est assumé, la parade est la détection (montée de `LOGIN_FAILED`) et le MFA, pas un verrouillage plus large qui nuirait aux utilisateurs légitimes. Les limites sont des points de départ à réviser sur données réelles.

## Alternatives rejetées

- **Strict** (login 3/15 min, IP globale 120/min, verrou à 3 échecs) — meilleure résistance au credential stuffing, mais risque réel de blocage d'une équipe entière derrière le NAT d'un lieu d'événement, ce qui est précisément le contexte d'usage du produit.
- **Permissif** (login 10/15 min, IP globale 600/min) — moins de faux positifs, résistance au bruteforce nettement plus faible.

## Vérification

- Test e2e : 6 tentatives de login échouées depuis la même IP pour le même email ⇒ la 6ᵉ renvoie `429` **et** la réponse reste `AUTH_INVALID_CREDENTIALS` sur les précédentes, sans jamais divulguer le verrouillage.
- Test e2e : un attaquant échouant sur l'email d'une victime ne l'empêche pas de se connecter depuis sa propre IP.
