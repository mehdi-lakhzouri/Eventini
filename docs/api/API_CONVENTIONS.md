# Eventini — Conventions d'API

> **Statut :** Spécification normative · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Applique :** [`SAAS_HTTP_API_GUIDELINES.md`](SAAS_HTTP_API_GUIDELINES.md) (Document C) — document générique, ici appliqué à Eventini
> **Décisions :** [ADR-0008](../adr/0008-response-envelope-rfc9457.md) enveloppe · [ADR-0010](../adr/0010-auth-route-naming.md) nommage des routes

> ⚠️ **Le backend expose aujourd'hui zéro route.** Aucun décorateur `@Get`/`@Post`/`@Put`/`@Patch`/`@Delete` n'existe dans `backend/src`. Les deux `@Controller` déclarés (`identity/authentication`, `identity/csrf`) ont un corps vide. Les 9 fonctions du client API frontend appellent des routes `/identity/*` qui n'existent d'aucun côté.

Ce document résout les choix que le Document C laissait ouverts et fournit les valeurs qu'il exigeait sans les donner.

---

## 1. Base et versionnement

```
https://api.eventini.com/api/v1
```

Version majeure dans le chemin. Interdits : `/v1.1`, `?version=2`, versionnement par route.

| Rupture (→ v2) | Non-rupture (reste v1) |
|---|---|
| retrait d'un champ obligatoire | ajout d'un champ optionnel |
| renommage d'un champ | ajout d'une route |
| changement de type | ajout d'un filtre optionnel |
| changement d'enum incompatible | ajout d'une valeur d'enum |
| changement du format d'erreur | amélioration interne |
| changement de règle d'authentification | nouvel index, gain de performance |

Dépréciation : `Deprecation: @1798761600`, `Sunset: Wed, 31 Dec 2027 23:59:59 GMT`, `Link: </docs/migration>; rel="deprecation"`.

---

## 2. URI

| Règle | |
|---|---|
| Noms, jamais de verbes | `/events` et non `/getEvents` |
| Pluriel | `/participants` |
| kebab-case | `/event-sessions` |
| Minuscules, sans extension | |
| Pas de slash final | |
| Imbrication ≤ 2 niveaux métier | `/events/{eventId}/sessions/{sessionId}` |
| Action = sous-ressource nominale | `POST /events/{id}/activation` |

**Le tenant n'apparaît pas dans l'URI.** Il vient de la session ([ADR-0002](../adr/0002-active-organization-resolution.md)). `/organizations/{organizationId}/…` n'existe que pour les routes qui administrent l'organisation elle-même, et l'identifiant y est **comparé** au contexte, jamais utilisé pour construire une requête.

---

## 3. Enveloppe

Les trois clés `data`, `meta`, `error` sont **toujours** présentes.

### Succès

```json
{
  "data": { "id": "evt_01JXYZ", "name": "Sommet 2026", "status": "ACTIVE" },
  "meta": {
    "requestId": "req_01JABCDEF",
    "timestamp": "2026-07-30T12:00:00.050Z",
    "apiVersion": "v1"
  },
  "error": null
}
```

`meta` porte **toujours** `requestId`, `timestamp`, `apiVersion` — c'est la résolution de C-4.

`201 Created` porte `Location: /api/v1/events/evt_01JXYZ`.

Action sans représentation : **`204 No Content`** par défaut. `200` avec `data: null` uniquement si l'appelant a besoin de `meta.requestId`. Résout un choix ouvert du Document C §10.4.

### Erreur — RFC 9457

```json
{
  "data": null,
  "meta": { "requestId": "req_01JABCDEF", "timestamp": "…", "apiVersion": "v1" },
  "error": {
    "type": "https://errors.eventini.com/validation-error",
    "title": "Validation failed",
    "status": 400,
    "code": "VALIDATION_ERROR",
    "detail": "One or more fields are invalid.",
    "instance": "/api/v1/events",
    "errors": [
      { "field": "startsAt", "code": "REQUIRED", "message": "The startsAt field is required." },
      { "field": "capacity", "code": "OUT_OF_RANGE", "message": "capacity must be between 1 and 100000." }
    ],
    "retryable": false
  }
}
```

`Content-Type: application/problem+json` sur les erreurs. Les URI `type` sont stables et documentaires ; elles ne sont pas résolues au MVP, ce que la RFC autorise explicitement.

---

## 4. Catalogue d'erreurs

Espace de noms unique. Le préfixe `AUTH_` marque le domaine d'authentification, pas le document d'origine. Résout C-3 et C-5.

### Générales

| Code | HTTP | Quand |
|---|---|---|
| `VALIDATION_ERROR` | 400 | corps ou paramètres invalides |
| `RESOURCE_NOT_FOUND` | 404 | ressource absente ou masquée |
| `RESOURCE_ALREADY_EXISTS` | 409 | violation d'unicité |
| `VERSION_CONFLICT` | 409 | verrou optimiste |
| `IDEMPOTENCY_CONFLICT` | 409 | même clé, corps différent |
| `PRECONDITION_FAILED` | 412 | `If-Match` non satisfait |
| `PRECONDITION_REQUIRED` | 428 | `If-Match` obligatoire, absent |
| `PAYLOAD_TOO_LARGE` | 413 | dépassement de taille |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | |
| `RATE_LIMIT_EXCEEDED` | 429 | |
| `INTERNAL_ERROR` | 500 | jamais de détail |
| `DEPENDENCY_UNAVAILABLE` | 503 | PostgreSQL ou Redis indisponible |

`PRECONDITION_FAILED` était absent du catalogue du Document C tout en apparaissant dans ses exemples (C-22). Il est ici officiel.

### Authentification et autorisation

Catalogue complet : [`AUTHENTICATION_AUTHORIZATION.md` §7](../security/AUTHENTICATION_AUTHORIZATION.md).

`AUTHENTICATION_REQUIRED` · `AUTH_INVALID_CREDENTIALS` · `AUTH_SESSION_EXPIRED` · `AUTH_SESSION_REVOKED` · `AUTH_MFA_REQUIRED` · `AUTH_MFA_INVALID` · `AUTH_CSRF_INVALID` · `AUTH_ORIGIN_DENIED` · `AUTH_TENANT_DENIED` · `AUTH_PERMISSION_DENIED` · `AUTH_REAUTHENTICATION_REQUIRED` · `AUTH_REFRESH_REUSE_DETECTED`

### Métier

| Code | HTTP | Quand |
|---|---|---|
| `ORGANIZATION_SUSPENDED` | 403 | organisation `SUSPENDED` ou `KILLED` |
| `EVENT_NOT_ACTIVE` | 409 | événement `DRAFT`, `EXPIRED` ou `CANCELLED` |
| `EVENT_SESSION_CLOSED` | 409 | session non `OPEN` |
| `CHECK_IN_WINDOW_CLOSED` | 409 | hors fenêtre |
| `ALREADY_CHECKED_IN` | 409 | doublon détecté |
| `TICKET_REVOKED` | 409 | |
| `TICKET_INVALID` | 400 | signature invalide |
| `TICKET_REPLAY_DETECTED` | 409 | nonce déjà revendiqué |
| `PARTICIPANT_NOT_REGISTERED` | 409 | |
| `SESSION_ACCESS_DENIED` | 403 | pas de `registration_sessions` `GRANTED` |
| `SCANNER_NOT_ASSIGNED` | 403 | appareil non affecté |
| `INVALID_STATE_TRANSITION` | 409 | transition interdite |
| `QUOTA_EXCEEDED` | 409 | `user_limit` ou `event_limit` atteint |

**Espaces de noms distincts** : un `eventCode` de log et un `error.code` HTTP peuvent porter le même texte (`RATE_LIMIT_EXCEEDED`, `TENANT_ACCESS_DENIED`). Ce sont deux catalogues indépendants, non synchronisés.

**Jamais exposé** : SQL, nom de table, trace d'exécution, chemin serveur, secret, existence d'un compte, détail de token, règle interne sensible.

---

## 5. Codes de statut

| Code | Usage |
|---|---|
| `200` | lecture, ou modification avec représentation |
| `201` | création — avec `Location` |
| `202` | traitement asynchrone accepté |
| `204` | succès sans corps |
| `400` | syntaxe ou paramètres invalides |
| `401` | authentification absente ou invalide |
| `403` | authentifié mais non autorisé |
| `404` | absent, ou masqué |
| `409` | conflit d'état ou de concurrence |
| `412` / `428` | précondition échouée / requise |
| `413` / `415` / `422` | trop grand / type non supporté / sémantiquement invalide |
| `429` | rate limit |
| `500` / `503` | erreur interne / dépendance indisponible |

Jamais : `200` masquant une erreur métier · `500` pour une validation client · `401` pour une permission insuffisante · une trace d'exécution.

**Ressource d'un autre tenant : `403 AUTH_TENANT_DENIED`.** Le Document C autorisait `404` pour masquer l'existence. Nous choisissons `403` : le `404` ne masque rien d'utile ici — l'attaquant sait déjà que l'identifiant existe, sinon il ne l'aurait pas — et il rend le débogage d'un vrai problème d'accès très pénible. Les rares cas où l'existence elle-même est sensible utilisent `404`, et sont documentés route par route.

**`DELETE` répété : `204`**, toujours. Résout un choix ouvert du Document C §8.5.

---

## 6. Pagination

Curseur uniquement. `page`/`offset` sont interdits : ils dérivent quand des lignes sont insérées entre deux appels.

```
GET /api/v1/events?limit=20&after=eyJ...&sortBy=createdAt&sortOrder=desc
```

| Paramètre | Défaut | Maximum |
|---|---|---|
| `limit` | **20** | **100** |
| `after` / `before` | — | mutuellement exclusifs |

Le Document C exigeait un défaut et un maximum sans jamais donner de valeur. Les voici.

```json
"meta": {
  "requestId": "req_01JABC", "timestamp": "…", "apiVersion": "v1",
  "pagination": {
    "limit": 20, "hasNextPage": true, "hasPreviousPage": false,
    "nextCursor": "eyJzb3J0VmFsdWUiOiIyMDI2LTA3LTMwIiwiaWQiOiJldnRfMDEifQ",
    "previousCursor": null
  }
}
```

**Tri par défaut : `createdAt DESC, id DESC`.** Le départage par `id` n'est pas cosmétique : deux lignes de même horodatage produiraient une pagination instable, avec des doublons et des omissions.

```sql
WHERE organization_id = $1
  AND (created_at < $2 OR (created_at = $2 AND id < $3))
ORDER BY created_at DESC, id DESC
LIMIT $4 + 1;   -- +1 pour calculer hasNextPage sans COUNT
```

Le curseur est **opaque et signé**. Il est invalidé si le tri, les filtres, le tenant, la portée ou la recherche changent — il embarque un hachage des paramètres canoniques.

`totalCount` n'est **pas** calculé par défaut : un `COUNT(*)` sur une grande table tenant coûte plus cher que la page elle-même. Un endpoint de statistiques dédié le fournit quand il est réellement nécessaire.

---

## 7. Tri, filtrage, recherche

```
?sortBy=createdAt&sortOrder=desc
?status=ACTIVE&status=DRAFT              multi-valeurs : répétition du paramètre
?createdFrom=2026-01-01T00:00:00Z&createdTo=2026-12-31T23:59:59Z
?search=dupont
?fields=id,name,status
?include=organization,sessions
```

**Multi-valeurs : répétition du paramètre**, pas de liste séparée par des virgules. Résout un choix ouvert du Document C §16.2. La répétition est sans ambiguïté quand une valeur contient elle-même une virgule.

| Contrainte | Valeur |
|---|---|
| `sortBy` | liste blanche par ressource — `createdAt`, `updatedAt`, `name`, `status`, `startsAt` |
| `sortOrder` | `asc` \| `desc` |
| `search` | 2 à 100 caractères, champs en liste blanche |
| `fields` | ≤ 50, liste blanche |
| `include` | ≤ 5 relations, **autorisation appliquée à chaque relation incluse** |

L'autorisation sur les relations incluses est le point critique : `?include=organization` ne doit jamais contourner l'étape 7 de la chaîne d'autorisation.

---

## 8. Idempotence et concurrence

Détail complet : [`IDEMPOTENCY_AND_CONCURRENCY.md`](IDEMPOTENCY_AND_CONCURRENCY.md).

```http
Idempotency-Key: 01JXYZABCDEF
If-Match: "evt_01JXYZ-v3"
```

`Idempotency-Key` est **obligatoire** sur : check-in, synchronisation offline, import, export, génération de ticket, création d'organisation, acceptation d'invitation.

`If-Match` est **obligatoire** sur toute mise à jour d'une ressource portant un `version` : `events`, `event_sessions`, `participants`, `registrations`, `organizations`. Absent ⇒ `428 PRECONDITION_REQUIRED`. Périmé ⇒ `412 PRECONDITION_FAILED`.

---

## 9. En-têtes

| Requête | Rôle |
|---|---|
| `Content-Type: application/json` | |
| `X-CSRF-Token` | mutations avec cookie ([ADR-0016](../adr/0016-pre-session-csrf-binding.md)) |
| `Idempotency-Key` | opérations rejouables |
| `If-Match` | concurrence optimiste |
| `traceparent` | W3C Trace Context |
| `X-Request-Id` | identifiant client, validé puis conservé ou remplacé |
| `Authorization: Bearer` | **mobile uniquement**, jamais le web |

| Réponse | Rôle |
|---|---|
| `X-Request-Id` | toujours présent |
| `Location` | sur `201` et `202` |
| `ETag` | ressources versionnées |
| `Retry-After` | `429` et `503` |
| `RateLimit-Limit` / `-Remaining` / `-Reset` | quota |
| `Deprecation` / `Sunset` | dépréciation |

`X-Request-Id` conserve son préfixe `X-` malgré la règle « éviter `X-*` » du Document C §22.3 (C-20) : aucun en-tête standard ne le remplace, et il est trop répandu pour être renommé. `Idempotency-Key` et `traceparent` évitent correctement le préfixe.

Sécurité et CORS : [`AUTHENTICATION_AUTHORIZATION.md` §4](../security/AUTHENTICATION_AUTHORIZATION.md).

---

## 10. Traitements asynchrones

```http
POST /api/v1/participants/imports
Idempotency-Key: 01JIMPORT

HTTP/1.1 202 Accepted
Location: /api/v1/jobs/job_01JXYZ
```

```json
{ "data": { "jobId": "job_01JXYZ", "status": "QUEUED",
            "statusUrl": "/api/v1/jobs/job_01JXYZ" } }
```

`GET /api/v1/jobs/{jobId}` :

```json
{ "data": { "id": "job_01JXYZ", "status": "PROCESSING",
            "progress": { "completed": 1200, "total": 5000, "percentage": 24 } } }
```

Statuts : `QUEUED` `PROCESSING` `SUCCEEDED` `FAILED` `CANCELLED` `EXPIRED`.

---

## 11. Familles de routes

```
/api/v1/auth/...                    authentification, sessions, MFA, mots de passe
/api/v1/me/...                      profil de l'utilisateur courant
/api/v1/organizations/...           administration d'organisation
/api/v1/events/...                  événements, sessions, inscriptions, présence
/api/v1/participants/...            participants et imports
/api/v1/scanners/...                appareils et affectations
/api/v1/reports/...                 rapports et exports
/api/v1/platform/...                administration plateforme (SUPER_ADMIN)
/api/v1/jobs/...                    suivi des traitements asynchrones
/api/v1/health/...                  liveness, readiness, startup
```

**La séparation par famille améliore la lisibilité ; elle ne remplace jamais un guard.** Une route sous `/platform/` n'est pas protégée par son préfixe — elle l'est par sa permission.

### Authentification — [ADR-0010](../adr/0010-auth-route-naming.md)

| Opération | Méthode | Route |
|---|---|---|
| Connexion | `POST` | `/auth/sessions` |
| Rotation | `POST` | `/auth/sessions/current/rotation` |
| Déconnexion | `DELETE` | `/auth/sessions/current` |
| Déconnexion globale | `DELETE` | `/auth/sessions` |
| Lister ses sessions | `GET` | `/auth/sessions` |
| Révoquer une session | `DELETE` | `/auth/sessions/{sessionId}` |
| Utilisateur courant | `GET` | `/auth/me` |
| Token CSRF | `GET` | `/auth/csrf-token` |
| Vérification MFA | `POST` | `/auth/mfa/challenges/{challengeId}/verification` |
| Enrôlement MFA | `POST` | `/auth/mfa/enrollments` |
| Confirmation d'enrôlement | `POST` | `/auth/mfa/enrollments/{enrollmentId}/confirmation` |
| Désactivation MFA | `DELETE` | `/auth/mfa/methods/{methodId}` |
| Recovery codes | `POST` | `/auth/mfa/recovery-codes` |
| Demande de reset | `POST` | `/auth/password-reset-requests` |
| Application du reset | `POST` | `/auth/password-resets` |
| Changement de mot de passe | `PUT` | `/auth/password` |
| Acceptation d'invitation | `POST` | `/auth/invitation-acceptances` |
| Réauthentification | `POST` | `/auth/reauthentications` |

### Organisations

| Opération | Méthode | Route | Permission |
|---|---|---|---|
| Lister ses organisations | `GET` | `/organizations` | — |
| Détail | `GET` | `/organizations/{organizationId}` | `organizations.read` |
| Mise à jour | `PATCH` | `/organizations/{organizationId}` | `organizations.manage` |
| **Activer le contexte** | `POST` | `/organizations/{organizationId}/activation` | membership actif |
| Membres | `GET` | `/organizations/{organizationId}/members` | `users.read` |
| Inviter | `POST` | `/organizations/{organizationId}/invitations` | `users.invite` |
| Révoquer une invitation | `DELETE` | `/organizations/{organizationId}/invitations/{invitationId}` | `users.invite` |
| Assigner un rôle | `PUT` | `/organizations/{organizationId}/members/{membershipId}/roles` | `users.manage_roles` |
| Suspendre un membre | `POST` | `/organizations/{organizationId}/members/{membershipId}/suspension` | `users.manage_roles` |

### Événements

| Opération | Méthode | Route | Permission |
|---|---|---|---|
| Lister | `GET` | `/events` | `events.read` |
| Créer | `POST` | `/events` | `events.create` |
| Détail | `GET` | `/events/{eventId}` | `events.read` |
| Mettre à jour | `PATCH` | `/events/{eventId}` | `events.update` + `If-Match` |
| Activer | `POST` | `/events/{eventId}/activation` | `events.activate` |
| Annuler | `POST` | `/events/{eventId}/cancellation` | `events.cancel` |
| Sessions | `GET` `POST` | `/events/{eventId}/sessions` | `event_sessions.manage` |
| Ouvrir une session | `POST` | `/events/{eventId}/sessions/{sessionId}/opening` | `event_sessions.manage` |
| Fermer une session | `POST` | `/events/{eventId}/sessions/{sessionId}/closure` | `event_sessions.manage` |
| Inscriptions | `GET` `POST` | `/events/{eventId}/registrations` | `registrations.manage` |
| Tickets | `POST` | `/events/{eventId}/registrations/{registrationId}/tickets` | `tickets.issue` |
| **Check-in** | `POST` | `/events/{eventId}/check-ins` | `attendance.check_in` + `Idempotency-Key` |
| Check-out | `POST` | `/events/{eventId}/check-outs` | `attendance.check_out` + `Idempotency-Key` |
| **Synchronisation offline** | `POST` | `/events/{eventId}/attendance-sync` | `attendance.check_in` + `Idempotency-Key` |
| Flux temps réel | `GET` | `/events/{eventId}/live` (SSE) | `events.read` |

### Plateforme

| Opération | Méthode | Route | Permission |
|---|---|---|---|
| Organisations | `GET` `POST` | `/platform/organizations` | `platform.organizations.manage` |
| Suspendre | `POST` | `/platform/organizations/{id}/suspension` | `platform.organizations.manage` |
| **Kill-switch** | `POST` | `/platform/organizations/{id}/kill-switch` | `platform.kill_switch.execute` + réauthentification |
| Métriques globales | `GET` | `/platform/metrics` | `platform.organizations.manage` |

---

## 12. OpenAPI

OpenAPI **3.1**, généré depuis les décorateurs NestJS, validé en CI, versionné dans `docs/api/openapi.yaml`.

Chaque opération porte : `operationId`, résumé, description, tags, `security`, paramètres, corps, réponses, erreurs, en-têtes, exemples, et une mention explicite du rate limit, de l'idempotence et de la concurrence applicables.

Schémas partagés : enveloppe de succès, enveloppe d'erreur, pagination, erreurs de validation, statut de job, schémas de sécurité.

En CI : validation du document, détection de rupture par rapport à la version précédente, comparaison implémentation ↔ contrat.

En production, la documentation interactive est protégée et ne contient **aucun** exemple porteur de secret.

---

## 13. Tests de contrat obligatoires

| # | Test | Attendu |
|---|---|---|
| 1 | Toute réponse porte `data`, `meta`, `error` | schéma unique validé |
| 2 | `meta` porte `requestId`, `timestamp`, `apiVersion` | toujours |
| 3 | Toute erreur valide le schéma RFC 9457 | |
| 4 | Aucune route ne se termine par un segment verbal | analyse d'OpenAPI |
| 5 | `limit=5000` | ramené à 100 ou `400` |
| 6 | Curseur trafiqué | `400`, jamais `500` |
| 7 | Curseur réutilisé après changement de tri | rejeté |
| 8 | Pagination sur horodatages identiques | ni doublon ni omission |
| 9 | Mise à jour sans `If-Match` | `428` |
| 10 | `If-Match` périmé | `412` |
| 11 | Même `Idempotency-Key`, corps différent | `409` |
| 12 | `X-Request-Id` client valide | conservé et renvoyé |
| 13 | ID valide d'un autre tenant | `403`, jamais `200` |
| 14 | `?include=` d'une relation non autorisée | `403` ou champ omis, jamais de fuite |
| 15 | `500` déclenché | aucune trace d'exécution dans le corps |
