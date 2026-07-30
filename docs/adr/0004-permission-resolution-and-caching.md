# ADR-0004 — Résolution et mise en cache des permissions

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | — |
| **Impacte** | `PermissionsGuard`, `TenantContextService`, cache Redis |
| **Invariants** | AUTH-INV-004, AUTH-INV-009, AUTH-INV-011 |

## Contexte

Les permissions doivent être scopées à quatre niveaux : plateforme, organisation, événement, session. Le Document B §17.2 interdit explicitement de placer « une liste massive de permissions » dans l'access token. Le Document B §32 liste 17 codes de permission ; le Document A §6.6 en liste 6 autres, avec la même convention `resource.action`.

Aucun document ne dit où les permissions effectives sont calculées ni si elles sont mises en cache.

## Décision

**L'access token ne contient aucune permission.** Les permissions effectives sont résolues côté serveur à chaque requête, avec un cache Redis versionné.

### Chaîne d'autorisation — 8 étapes, dans cet ordre, fail closed

| # | Vérification | Refus |
|---|---|---|
| 1 | Signature, `iss`, `aud`, `exp`, `alg` explicite de l'access token | `401 AUTHENTICATION_REQUIRED` |
| 2 | `user_sessions.status = ACTIVE`, non expirée (idle **et** absolue) | `401 AUTH_SESSION_EXPIRED` / `AUTH_SESSION_REVOKED` |
| 3 | `users.status = ACTIVE` et `users.version` cohérent avec le claim `ver` | `401` |
| 4 | `organizations.status = ACTIVE` et `is_enabled = true` | `403 AUTH_TENANT_DENIED` |
| 5 | `organization_memberships.status = ACTIVE` | `403 AUTH_TENANT_DENIED` |
| 6 | La permission demandée est dans l'ensemble effectif | `403 AUTH_PERMISSION_DENIED` |
| 7 | `resource.organization_id = ctx.organizationId` | `403 AUTH_TENANT_DENIED` |
| 8 | L'état de la ressource autorise l'action (event `ACTIVE`, session `OPEN`, …) | `409` + code métier |

Les étapes 7 et 8 sont ce qui distingue l'autorisation de la simple authentification : sans elles, un ID valide d'un autre tenant passe. Elles sont **non facultatives**.

### Routage par scope

| Scope du rôle | Table d'assignation | Source |
|---|---|---|
| `PLATFORM` | `platform_role_assignments` | Document A §7.4 |
| `ORGANIZATION` | `membership_role_assignments` | Document A §7.4 |
| `EVENT` | `event_user_assignments` | Document A §7.4 |

Une permission de scope `EVENT` n'est accordée que si une assignation événementielle **non révoquée** et dans sa fenêtre de validité existe. Une permission d'organisation ne donne **pas** automatiquement accès à tous les événements.

### Cache

```
clé    perms:{membershipId}:v{permissionsVersion}
       perms:platform:{userId}:v{permissionsVersion}
TTL    300 s (organisation) · 60 s (plateforme, privilège plus élevé)
valeur ensemble de codes de permission, sérialisé
```

`permissionsVersion` est un compteur Redis + colonne miroir, incrémenté **dans la même transaction** que tout changement de rôle, de membership ou de statut d'organisation. Un incrément invalide instantanément toutes les entrées de l'ancienne version — aucune suppression de clé n'est nécessaire, aucune fenêtre de cohérence.

**Repli** — Redis indisponible ⇒ lecture PostgreSQL directe, log `warn` + `eventCode: SESSION_CACHE_MISS`, métrique `redis_fallback_total`. **Jamais** de repli sur « autoriser ».

## Conséquences

**Positives** — une révocation de rôle est effective immédiatement, ce qu'aucune approche par token ne permet ; le token reste petit ; le cache absorbe le coût des jointures ; aucune invalidation par clé, donc aucun bug d'invalidation partielle.

**Négatives** — une dépendance Redis dans le chemin d'autorisation (atténuée par le repli PostgreSQL) ; le compteur de version doit être incrémenté de façon transactionnelle, un oubli produit des permissions périmées jusqu'au TTL.

## Alternatives rejetées

- **Permissions compactées dans le token** — le plus rapide, mais une permission révoquée reste valide jusqu'à l'expiration de l'access token (5 à 15 minutes). Contredit AUTH-INV-009.
- **PostgreSQL sans cache** — toujours correct, aucun bug d'invalidation, mais un aller-retour par requête autorisée. Retenu comme **comportement de repli**, pas comme nominal.

## Vérification

Test e2e : révoquer un rôle, puis appeler immédiatement une route protégée par ce rôle avec le token existant ⇒ `403` sans attendre l'expiration.
