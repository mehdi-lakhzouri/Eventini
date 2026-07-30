# ADR-0002 — Résolution de l'organisation active

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | comble un trou du Document B §31 |
| **Impacte** | `user_sessions`, tous les guards, toutes les routes tenant-scopées |

## Contexte

Un utilisateur peut appartenir à **plusieurs organisations** (Document A §6.4, contexte produit §7.2). Le Document B §31 exige la chaîne `Session active → User actif → Membership actif → Organisation active → Tenant Context → Permission → Resource ownership` et interdit de faire confiance à un `organizationId` provenant du body, de la query, du frontend ou d'un route param **seul**.

Mais aucun document ne dit **comment** l'organisation active est déterminée ni comment un utilisateur en change. Sans cette décision, chaque développeur inventerait son mécanisme, et le premier oubli de guard deviendrait une fuite cross-tenant.

## Décision

**L'organisation active est portée par la session serveur.** Les colonnes `user_sessions.organization_id` et `user_sessions.active_membership_id` — déjà présentes dans le Document A §6.12 — sont l'**unique** source de vérité.

```
Cookie __Host-eventini_access → claim sid
  → user_sessions.organization_id + active_membership_id
  → TenantContext { organizationId, membershipId, userId, sessionId, authLevel }
```

Un `organizationId` reçu du client (path, query, body) n'est **jamais** utilisé pour construire une requête. Il est uniquement **comparé** au contexte : divergence ⇒ `403 AUTH_TENANT_DENIED` + security event `TENANT_ACCESS_DENIED`.

Le changement d'organisation est une opération explicite et auditée :

```
POST /api/v1/organizations/{organizationId}/activation
  1. membership ACTIVE pour (user, organization) ?      sinon 403
  2. organisation ACTIVE (ni SUSPENDED, ni KILLED) ?    sinon 403
  3. nouvelle ligne user_sessions, nouvelle token_family_id
  4. ancienne session → status REPLACED, tokens révoqués
  5. nouveaux cookies access + refresh + CSRF émis
  6. security event ORGANIZATION_CONTEXT_SWITCHED
```

Les sessions `SUPER_ADMIN` de portée plateforme ont `organization_id IS NULL` et `active_membership_id IS NULL` (voir [ADR-0003](0003-tenant-isolation-strategy.md) pour la contrainte CHECK associée).

## Conséquences

**Positives** — un `organizationId` forgé est structurellement inexploitable ; le changement d'organisation produit une rotation complète, donc un vol de token ne survit pas au changement de contexte ; la piste d'audit est explicite ; le tenant est disponible sans aucun accès base dans le chemin chaud.

**Négatives** — un utilisateur ne peut pas travailler simultanément sur deux organisations dans deux onglets : le changement est global à la session. C'est un compromis accepté au profit de l'isolation. Si le besoin apparaît, il faudra des sessions parallèles indexées par un identifiant de contexte, pas un header par requête.

## Alternatives rejetées

- **Header `X-Organization-Id` par requête, session agnostique** — permet le multi-onglets, mais chaque endpoint dépend de la présence du guard. Un seul oubli = lecture cross-tenant silencieuse. Surface de risque inacceptable pour un SaaS.
- **Organisation dans le chemin `/organizations/{id}/…` partout** — viole le Document C §5 (« ne pas exiger `/tenants/{id}` quand le tenant vient du contexte d'authentification ») et rend chaque URL réécrivable à la main.
- **Ceinture et bretelles (session + path obligatoire)** — redondance utile mais verbeuse ; retenue uniquement là où la route contient déjà `{organizationId}` pour des raisons de lisibilité.

## Vérification

Test e2e obligatoire : un utilisateur membre de A et B, session active sur A, appelle une ressource de B avec un ID valide ⇒ `403`, jamais `404` masqué, jamais `200`.
