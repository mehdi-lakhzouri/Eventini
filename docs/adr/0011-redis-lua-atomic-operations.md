# ADR-0011 — Scripts Lua pour les opérations Redis atomiques

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | comble un trou total du corpus |
| **Impacte** | rate limiting, lockout, anti-rejeu, verrous distribués |
| **Fichiers** | `scripts/redis/*.lua` |

## Contexte

Le corpus ne contient **aucun** schéma de nommage de clés Redis, **aucun** TTL, et **aucune** mention de Lua — vérifié par `grep`. Le dépôt ne contient aucun fichier `.lua`, aucun `eval(`, et `@nestjs/throttler` est installé sans jamais être importé.

Or trois exigences imposent de l'atomicité :

- Document B §33 — rate limiting multi-dimension et lockout progressif, valides sur plusieurs instances ;
- Document B §34.6 — anti-rejeu ;
- Document C §19.6 — « réserver atomiquement » une clé d'idempotence, avec la précision qu'« un simple `find then insert` est vulnérable ».

Un `INCR` suivi d'un `EXPIRE` en deux allers-retours n'est pas atomique : un crash entre les deux laisse un compteur sans TTL, c'est-à-dire un utilisateur bloqué indéfiniment.

## Décision

**Quatre scripts Lua**, versionnés dans `scripts/redis/`, chargés par `SCRIPT LOAD` au démarrage, appelés en `EVALSHA` avec repli `EVAL` sur `NOSCRIPT`.

| Script | Rôle |
|---|---|
| `rate-limit-sliding-window.lua` | Fenêtre glissante par sorted set — compte, décide et enregistre en un aller-retour |
| `lockout-register-failure.lua` | Incrémente l'échec, applique l'échelle progressive, retourne `{locked, until, attempts}` |
| `anti-replay-claim.lua` | Revendique un nonce à usage unique — `1` première fois, `0` en cas de rejeu |
| `distributed-lock.lua` | Acquisition et libération avec jeton de propriété (une instance ne libère jamais le verrou d'une autre) |

**L'idempotence n'utilise pas Lua.** Elle est portée par PostgreSQL — voir [ADR-0012](0012-idempotency-storage.md). Redis n'y sert que de court-circuit sur le chemin chaud, jamais de source de vérité.

### Discipline

- Les scripts sont **purs** : aucune clé n'est construite dans le script, toutes arrivent par `KEYS`. C'est ce qui les rend compatibles Redis Cluster.
- Chaque script porte un entête de version. Une modification incompatible crée un **nouveau fichier**, elle ne modifie pas l'existant — un `EVALSHA` en vol pendant un déploiement ne doit jamais changer de sémantique.
- Chaque script a un test d'intégration contre le Redis de `docker-compose`, y compris les cas limites : première requête, requête à la limite exacte, expiration de fenêtre, appels concurrents.
- Aucun script n'appelle `redis.call('KEYS', …)` ni de commande non déterministe.

### Repli si Redis est indisponible

Le Document C §21.9 laissait le choix ouvert. **Décision : fail closed sur les endpoints d'authentification** (`503 DEPENDENCY_UNAVAILABLE`), **fail open avec log `error` sur le reste**. Un rate limiter en panne ne doit pas rendre l'application inutilisable, mais il ne doit jamais ouvrir la porte au bruteforce.

## Conséquences

**Positives** — un aller-retour au lieu de deux à quatre, ce qui compte sur le chemin de chaque requête ; aucune fenêtre de course ; aucun compteur orphelin sans TTL ; la logique de décision est au même endroit que la donnée.

**Négatives** — du Lua à maintenir et à tester, dans un langage que l'équipe n'utilise nulle part ailleurs ; un script bloquant bloque le serveur Redis entier, ce qui impose des scripts courts et sans boucle non bornée ; le débogage est moins confortable qu'en TypeScript.

## Alternatives rejetées

- **Lua uniquement pour rate limit et lockout** — couvre les deux risques les plus élevés, laisse anti-rejeu et verrous sur `SET NX PX`, déjà atomique. Défendable, mais la libération de verrou sans vérification de propriétaire reste une faille classique, et elle exige de toute façon du Lua.
- **Aucun Lua** — `INCR`/`EXPIRE` en pipeline, `SET NX PX`, contraintes PostgreSQL. Le plus simple à opérer ; laisse fuir quelques requêtes au-delà de la limite sous contention et peut laisser des compteurs sans TTL.

## Vérification

Les quatre scripts s'exécutent contre le Redis de `docker-compose` via `redis-cli --eval` et retournent les formes documentées. C'est le seul livrable de ce lot documentaire qui soit réellement exécutable ; il est donc réellement exécuté.
