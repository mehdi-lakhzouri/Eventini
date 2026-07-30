# ADR-0014 — Un seul dépôt pour le hash du refresh token

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | **C-1**, **C-27** |
| **Impacte** | `user_sessions`, `refresh_token_rotations`, rotation et détection de rejeu |
| **Invariants** | AUTH-INV-002, AUTH-INV-003 |

## Contexte

Contradiction entre les deux baselines :

- **Document B §19** liste `currentRefreshTokenHash` parmi les champs du registre de session.
- **Document A §6.12** définit `user_sessions` **sans** cette colonne ; le hash n'existe que dans `refresh_token_rotations.token_hash`, avec l'index unique `ux_refresh_token_hash`.

Par ailleurs, le Document A §6.13 affirme « un seul token `ACTIVE` logique par session/famille » mais ne spécifie **aucun index** qui l'impose — seul `ix_refresh_family_status`, non unique, est listé (C-27).

## Décision

**`refresh_token_rotations.token_hash` est l'unique dépôt.** Aucune colonne `current_refresh_token_hash` n'est ajoutée à `user_sessions`.

L'invariant « un seul token actif par famille » est rendu **structurel** par un index partiel :

```sql
CREATE UNIQUE INDEX ux_refresh_active_per_family
  ON refresh_token_rotations (token_family_id)
  WHERE status = 'ACTIVE';
```

Cet index n'est pas une optimisation : c'est ce qui rend la rotation concurrente sûre. Deux rafraîchissements simultanés avec le même token ne peuvent pas réussir tous les deux — le second viole l'index et échoue, sans dépendre d'un verrou applicatif.

Le token actif courant se lit ainsi :

```sql
SELECT token_hash FROM refresh_token_rotations
WHERE token_family_id = $1 AND status = 'ACTIVE';
```

Requête indexée, coût négligeable, sur un chemin qui n'est parcouru qu'au rafraîchissement — pas à chaque requête.

Le hash est un **HMAC-SHA-256** avec le secret dédié « HMAC refresh » du Document B §40.2, sur un token opaque de **32 octets** d'entropie. HMAC plutôt que hash simple : cela empêche une recherche par table arc-en-ciel sur un dump de base, et le Document A laissait le choix ouvert (« Hash ou HMAC »).

## Conséquences

**Positives** — une seule source de vérité, donc aucun risque de divergence entre la session et l'historique de rotation ; la détection de rejeu se réduit à « le hash présenté correspond à une ligne `CONSUMED` ou `REVOKED` », ce qui est direct ; l'unicité par famille est garantie par le moteur, pas par du code.

**Négatives** — une jointure ou une requête supplémentaire au rafraîchissement, par rapport à une lecture dénormalisée sur `user_sessions` ; strictement négligeable au regard du risque de désynchronisation.

## Alternatives rejetées

- **Dénormaliser dans `user_sessions`** — évite une lecture, mais crée deux emplacements pour la même vérité. Si les deux divergent — bug, rollback partiel, transaction incomplète — l'invariant de rotation devient indéterminé, et c'est exactement l'invariant qui protège contre le vol de token.
- **Hash simple SHA-256** — suffisant si le token a 32 octets d'entropie, mais le HMAC coûte la même chose et ajoute une défense en cas de fuite de base.

## Vérification

- Test d'intégration : deux rafraîchissements concurrents avec le même refresh token ⇒ exactement un succès, l'autre échoue sur violation de `ux_refresh_active_per_family`.
- Test e2e : rejouer un token déjà consommé ⇒ session `COMPROMISED`, famille entière révoquée, aucun nouveau token émis, security event `REFRESH_TOKEN_REUSE_DETECTED`.
