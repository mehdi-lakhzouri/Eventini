# Architecture Decision Records — Eventini

Chaque ADR fige une décision qui était **ouverte, contradictoire ou absente** dans le corpus de spécifications. Une décision qui n'est pas ici n'est pas une décision : c'est une opinion.

## Règles

1. Un ADR n'est **jamais modifié** après acceptation. Il est superséde par un nouvel ADR, qui le référence.
2. Les numéros ne sont **jamais** réutilisés.
3. Tout code qui contredit un ADR accepté est un bug, pas une variante.
4. Un ADR qui résout une contradiction du corpus porte son identifiant `C-xx`, référencé dans le [registre de réconciliation](../PROJECT_DOCUMENTATION_INDEX.md).

## Registre

| ADR | Décision | Résout | Statut |
|---|---|---|---|
| [0001](0001-documentation-language.md) | Langue de la documentation — français, identifiants en anglais | — | Accepté |
| [0002](0002-active-organization-resolution.md) | Organisation active portée par la session + endpoint d'activation | trou B §31 | Accepté |
| [0003](0003-tenant-isolation-strategy.md) | Isolation applicative + extension Prisma qui échoue en dur, sans RLS | — | Accepté |
| [0004](0004-permission-resolution-and-caching.md) | Permissions résolues en base, cache Redis versionné, jamais dans le token | — | Accepté |
| [0005](0005-token-signing-eddsa.md) | EdDSA (Ed25519) via `jose`, rotation par `kid` | trou B §17 | Accepté |
| [0006](0006-organizationid-terminology.md) | `organizationId` comme unique terme pour le tenant | C-6, C-7 | Accepté |
| [0007](0007-password-hashing-argon2id.md) | Argon2id m=19456 t=2 p=1 + pepper natif | trou B §26 | Accepté |
| [0008](0008-response-envelope-rfc9457.md) | Enveloppe RFC 9457, catalogue d'erreurs unifié | C-3, C-4, C-5, C-22 | Accepté |
| [0009](0009-token-and-session-lifetimes.md) | Durées différenciées par `clientType` et privilège | trou B §14 | Accepté |
| [0010](0010-auth-route-naming.md) | Routes d'authentification en sous-ressources nominales | C-2 | Accepté |
| [0011](0011-redis-lua-atomic-operations.md) | 4 scripts Lua pour les opérations Redis atomiques | trou total | Accepté |
| [0012](0012-idempotency-storage.md) | `idempotency_records` en PostgreSQL, Redis en court-circuit | C-9 | Accepté |
| [0013](0013-rate-limiting-and-lockout-baseline.md) | Limites chiffrées, lockout sur `ip+email` | trou total | Accepté |
| [0014](0014-refresh-token-hash-single-store.md) | Hash du refresh token dans une seule table + index partiel | C-1, C-27 | Accepté |
| [0015](0015-scanner-role-scope.md) | `SCANNER` de portée `EVENT` | C-17 | Accepté |
| [0016](0016-pre-session-csrf-binding.md) | Liaison CSRF pré-session + rebinding au login | C-16, C-18, C-19 | Accepté |
| [0017](0017-delivery-model.md) | Sprints de 2 semaines, Conventional Commits, checks requis | trou total | Accepté — modèle de branches supersédé par 0018 |
| [0018](0018-git-branching-model.md) | Modèle de branches `master` + `develop`, releases aux jalons | — | Accepté |

## Gabarit

```markdown
# ADR-00XX — Titre à l'impératif

| | |
|---|---|
| **Statut** | Proposé / Accepté / Supersédé par ADR-00YY |
| **Date** | AAAA-MM-JJ |
| **Contradiction résolue** | C-xx ou « — » |
| **Impacte** | fichiers, tables ou modules concernés |

## Contexte
Le problème, et pourquoi il faut trancher maintenant.

## Décision
Ce qui est décidé. Au présent, à l'affirmatif, avec les valeurs exactes.

## Conséquences
**Positives** — ce que l'on gagne.
**Négatives** — ce que l'on paie. Une section vide signale un ADR malhonnête.

## Alternatives rejetées
Ce qui a été envisagé et pourquoi cela n'a pas été retenu.

## Vérification
Le test qui prouve que la décision est appliquée.
```
