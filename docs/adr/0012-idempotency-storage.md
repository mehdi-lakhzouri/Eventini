# ADR-0012 — Stockage et sémantique de l'idempotence

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | **C-9**, et 3 choix ouverts du Document C §19 |
| **Impacte** | table `idempotency_records`, intercepteur d'idempotence, synchronisation offline |

## Contexte

Le Document C §19 spécifie l'idempotence de façon complète : header `Idempotency-Key`, empreinte canonique, 5 états, 12 colonnes de stockage, et l'exigence que « l'unicité soit garantie par la base ou un mécanisme atomique équivalent ».

Mais la liste des 21 tables du Document A et son plan de 8 migrations **ne contiennent aucune table d'idempotence** (C-9). Trois choix restaient ouverts : le comportement face à une requête en vol, la rétention, et le mécanisme de réservation.

C'est structurellement critique pour Eventini : le check-in offline rejoué après un timeout réseau **doit** produire un seul enregistrement de présence.

## Décision

**PostgreSQL est la source de vérité ; Redis n'est qu'un court-circuit.**

### Table

```sql
CREATE TABLE idempotency_records (
  id                  TEXT PRIMARY KEY,
  organization_id     TEXT NULL REFERENCES organizations(id),
  actor_id            TEXT NOT NULL,
  actor_session_id    TEXT NULL REFERENCES user_sessions(id),
  method              TEXT NOT NULL,
  route               TEXT NOT NULL,          -- gabarit, pas l'URI concrète
  idempotency_key     TEXT NOT NULL,
  request_hash        TEXT NOT NULL,          -- SHA-256 de l'empreinte canonique
  status              TEXT NOT NULL,          -- PENDING COMPLETED FAILED_RETRYABLE FAILED_FINAL EXPIRED
  response_status     INTEGER NULL,
  response_body       JSONB NULL,
  response_ref        TEXT NULL,              -- pour les réponses volumineuses
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at          TIMESTAMPTZ NOT NULL,
  locked_until        TIMESTAMPTZ NULL
);

CREATE UNIQUE INDEX ux_idempotency_scope
  ON idempotency_records (organization_id, actor_id, method, route, idempotency_key);
```

L'unicité inclut `organization_id` et `actor_id` : la même clé dans deux organisations ne peut pas entrer en collision, ce qu'exige explicitement le Document C §19.5.

### Réservation

```sql
INSERT INTO idempotency_records (...) VALUES (...)
ON CONFLICT (organization_id, actor_id, method, route, idempotency_key) DO NOTHING
RETURNING id;
```

Aucune ligne retournée ⇒ la clé existe déjà. **Aucun verrou n'est nécessaire** : l'index unique fait le travail, dans la transaction, avec la garantie de durabilité de PostgreSQL. C'est le « mécanisme atomique équivalent » du Document C.

### Empreinte canonique

`SHA-256` de la concaténation ordonnée : `method` · gabarit de route · `organizationId` · `actorId` · corps JSON canonicalisé (clés triées, espaces normalisés) · paramètres métier significatifs. Les headers volatils (`traceparent`, `User-Agent`, `X-Request-Id`) sont **exclus** — sinon deux rejeux légitimes produiraient deux empreintes.

### Sémantique

| Cas | Réponse |
|---|---|
| Première requête | exécution normale, réponse stockée |
| Rejeu identique (`COMPLETED`) | réponse stockée renvoyée, `meta.idempotency.replayed = true` |
| Même clé, corps différent | `409 IDEMPOTENCY_CONFLICT` |
| Requête en vol (`PENDING`) | **`409` + `Retry-After: 2`** |
| Clé expirée | traitée comme une première requête |

**Requête en vol : `409` retenu**, pas l'attente. Un client bloqué consomme une connexion serveur ; un `409` avec `Retry-After` déplace l'attente côté client, où elle ne coûte rien. Résout un choix ouvert du Document C §19.9.

### Rétention

| Portée | Durée |
|---|---|
| Nominal | **24 h** |
| Synchronisation attendance / offline | **7 j** |

7 jours parce qu'un scanner peut rester déconnecté toute la durée d'un événement multi-jours. Une rétention de 24 h transformerait un rejeu légitime en double check-in. Purge par job BullMQ quotidien sur `expires_at`. Résout le choix ouvert du Document C §19.10.

## Conséquences

**Positives** — un `FLUSHALL` Redis ne peut pas provoquer de double check-in ; la garantie est celle de PostgreSQL, pas d'un cache ; respecte le principe « Redis n'est jamais la source de vérité » ; les enregistrements sont auditables et interrogeables.

**Négatives** — une écriture PostgreSQL supplémentaire par requête idempotente ; `response_body JSONB` peut grossir, d'où `response_ref` pour les grosses réponses ; la table nécessite une purge planifiée, dont l'absence deviendrait un problème de volumétrie silencieux.

## Alternatives rejetées

- **Attente courte sur requête en vol** — meilleure ergonomie pour un scanner mobile qui réessaie sur timeout, au prix d'une connexion serveur retenue et de tests de timeout délicats. Réévaluable si les `409` s'avèrent fréquents en production.
- **Idempotence Redis seule** — le plus rapide, zéro migration ; un flush Redis transforme chaque rejeu en pause en double exécution. Contredit un principe explicite du contexte produit §5.2.

## Vérification

- Test e2e : deux `POST` de check-in identiques avec la même `Idempotency-Key` ⇒ un seul `attendance_records`, deux réponses identiques, la seconde avec `replayed: true`.
- Test e2e : même clé, corps différent ⇒ `409 IDEMPOTENCY_CONFLICT`.
- Test e2e : même clé dans deux organisations ⇒ deux exécutions distinctes, aucune collision.
