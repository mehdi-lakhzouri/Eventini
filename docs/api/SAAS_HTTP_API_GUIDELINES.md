<!-- ENTÊTE DE PROVENANCE — ajouté le 30 juillet 2026, contenu d'origine non modifié -->
> ### 🔖 Statut documentaire : `BASELINE GÉNÉRIQUE — CHOIX OUVERTS RÉSOLUS AILLEURS`
>
> | | |
> |---|---|
> | **Chemin canonique** | `docs/api/SAAS_HTTP_API_GUIDELINES.md` |
> | **Ancien chemin** | `docs/SaaS-HTTP-API-Design-Security-Implementation-Guidelines.md` |
> | **Référence dans le corpus** | **Document C** |
> | **Nature** | Document **générique**, non spécifique à Eventini : il utilise volontairement `accounts` / `projects` / `items` / `jobs` comme ressources d'exemple. Il énonce les règles ; il ne décrit aucune route Eventini. |
> | **Fait autorité pour** | codes de statut HTTP (§9), enveloppe de réponse (§10), enveloppe d'erreur RFC 9457 (§11), pagination par curseur (§13-14), tri/filtrage/recherche (§15-18), idempotence (§19), concurrence (§20), rate limiting — mécanismes (§21), inventaire des headers (§22-24), OpenAPI (§35) |
> | **Complété par** | [`API_CONVENTIONS.md`](API_CONVENTIONS.md) — application à Eventini, catalogue d'erreurs unifié, table des routes réelles · [`IDEMPOTENCY_AND_CONCURRENCY.md`](IDEMPOTENCY_AND_CONCURRENCY.md) — algorithme d'empreinte et machine à états |
> | **Choix laissés ouverts, désormais tranchés** | `limit` par défaut / maximum · convention DELETE répété · `204` vs `200 data:null` · filtres multi-valeurs · requête idempotente en vol · rétention d'idempotence · mode de repli si Redis est indisponible — voir [ADR-0008](../adr/0008-response-envelope-rfc9457.md) et [ADR-0012](../adr/0012-idempotency-storage.md) |
> | **Contredit sur** | le vocabulaire `tenantId` (§16.4, §24.3, §36.1, §37.2) est remplacé par `organizationId` — voir [ADR-0006](../adr/0006-organizationid-terminology.md) |
> | **Registre des conflits** | [`PROJECT_DOCUMENTATION_INDEX.md` §5](../PROJECT_DOCUMENTATION_INDEX.md) — entrées C-1 à C-31 |

---

# Guide de conception et d’implémentation des API HTTP pour un SaaS

> **Document de référence pour agent IA et équipe d’ingénierie**  
> **Version :** 1.0  
> **Statut :** Baseline de conception production  
> **Portée :** API HTTP/REST générique pour SaaS multi-tenant  
> **Format recommandé :** JSON + enveloppe `data / meta / error`  
> **Documentation :** OpenAPI  
> **Date :** 28 juillet 2026

---

## Table des matières

1. [Objet du document](#1-objet-du-document)
2. [Conventions normatives](#2-conventions-normatives)
3. [Objectifs d’une API SaaS production](#3-objectifs-dune-api-saas-production)
4. [Principes fondamentaux](#4-principes-fondamentaux)
5. [Convention générale des URI](#5-convention-générale-des-uri)
6. [Versionnement](#6-versionnement)
7. [Ressources et routes imbriquées](#7-ressources-et-routes-imbriquées)
8. [Méthodes HTTP](#8-méthodes-http)
9. [Codes de statut HTTP](#9-codes-de-statut-http)
10. [Format uniforme des réponses](#10-format-uniforme-des-réponses)
11. [Format uniforme des erreurs](#11-format-uniforme-des-erreurs)
12. [Métadonnées de réponse](#12-métadonnées-de-réponse)
13. [Pagination par curseur](#13-pagination-par-curseur)
14. [Pagination précédente et suivante](#14-pagination-précédente-et-suivante)
15. [Tri](#15-tri)
16. [Filtrage](#16-filtrage)
17. [Recherche](#17-recherche)
18. [Sélection et expansion des champs](#18-sélection-et-expansion-des-champs)
19. [Idempotence](#19-idempotence)
20. [Contrôle de concurrence](#20-contrôle-de-concurrence)
21. [Rate limiting](#21-rate-limiting)
22. [Headers standards](#22-headers-standards)
23. [Headers de sécurité](#23-headers-de-sécurité)
24. [Headers d’observabilité](#24-headers-dobservabilité)
25. [Authentification et autorisation](#25-authentification-et-autorisation)
26. [Multi-tenancy](#26-multi-tenancy)
27. [Validation des entrées](#27-validation-des-entrées)
28. [Protection contre le mass assignment](#28-protection-contre-le-mass-assignment)
29. [Limites de ressources](#29-limites-de-ressources)
30. [Traitements asynchrones](#30-traitements-asynchrones)
31. [Imports, exports et fichiers](#31-imports-exports-et-fichiers)
32. [Webhooks](#32-webhooks)
33. [Caching HTTP](#33-caching-http)
34. [Dépréciation et fin de vie](#34-dépréciation-et-fin-de-vie)
35. [Documentation OpenAPI](#35-documentation-openapi)
36. [Journalisation](#36-journalisation)
37. [Métriques et traces](#37-métriques-et-traces)
38. [Sécurité API](#38-sécurité-api)
39. [Exemples génériques complets](#39-exemples-génériques-complets)
40. [Tests obligatoires](#40-tests-obligatoires)
41. [Architecture backend recommandée](#41-architecture-backend-recommandée)
42. [Règles d’implémentation pour l’agent IA](#42-règles-dimplémentation-pour-lagent-ia)
43. [Critères d’acceptation](#43-critères-dacceptation)
44. [Checklist de production](#44-checklist-de-production)
45. [Références normatives et techniques](#45-références-normatives-et-techniques)

---

# 1. Objet du document

Ce document définit une convention complète pour concevoir, implémenter, documenter, sécuriser et tester une API HTTP de SaaS.

Il ne décrit pas une API métier particulière. Les exemples utilisent volontairement des ressources génériques telles que :

- `accounts` ;
- `projects` ;
- `items` ;
- `jobs` ;
- `members`.

Le document doit permettre à un agent IA de produire une implémentation cohérente sans inventer des conventions route par route.

L’agent doit considérer ce document comme une **source de vérité architecturale**.

---

# 2. Conventions normatives

Les termes suivants ont une signification normative :

| Terme | Signification |
|---|---|
| **MUST / DOIT** | Exigence obligatoire |
| **MUST NOT / NE DOIT PAS** | Interdiction absolue |
| **SHOULD / DEVRAIT** | Recommandation forte, dérogation documentée |
| **SHOULD NOT / NE DEVRAIT PAS** | Pratique déconseillée |
| **MAY / PEUT** | Option autorisée |

Toute dérogation à une règle `MUST` doit être considérée comme une non-conformité.

Toute dérogation à une règle `SHOULD` doit être documentée avec :

- la justification ;
- le risque ;
- les compensations ;
- la décision d’architecture.

---

# 3. Objectifs d’une API SaaS production

Une API SaaS robuste doit être :

- cohérente ;
- prévisible ;
- versionnée ;
- idempotente lorsque nécessaire ;
- résistante aux appels simultanés ;
- multi-tenant ;
- sécurisée ;
- observable ;
- paginable ;
- documentée ;
- testable ;
- scalable ;
- compatible avec plusieurs clients ;
- explicite sur ses erreurs ;
- stable dans le temps.

Le contrat HTTP doit rester indépendant de :

- l’ORM ;
- la structure interne des tables ;
- le framework frontend ;
- la forme des entités de domaine ;
- les noms des classes internes.

---

# 4. Principes fondamentaux

## 4.1 Contract first

L’API DOIT être décrite avant ou en parallèle de l’implémentation.

Le contrat inclut :

- URI ;
- méthode ;
- paramètres ;
- headers ;
- body ;
- réponse ;
- erreurs ;
- permissions ;
- rate limits ;
- idempotence ;
- concurrence ;
- exemples.

## 4.2 Uniformité

Toutes les routes DOIVENT appliquer les mêmes conventions.

Exemples :

- même format d’erreur ;
- même pagination ;
- même nommage ;
- mêmes headers ;
- mêmes codes de statut ;
- même format de date.

## 4.3 Ressources, pas actions techniques

Préférer :

```text
POST /api/v1/jobs
```

à :

```text
POST /api/v1/createJob
```

Préférer :

```text
POST /api/v1/orders/{orderId}/cancellation
```

à :

```text
POST /api/v1/cancelOrder
```

Une action métier complexe PEUT être modélisée comme une sous-ressource.

## 4.4 Backend autoritaire

Le serveur DOIT être la source de vérité pour :

- tenant ;
- permissions ;
- propriété des ressources ;
- limites ;
- transitions d’état ;
- invariants métier.

## 4.5 Ne jamais exposer directement l’ORM

Les réponses HTTP NE DOIVENT PAS retourner directement :

- un modèle Prisma ;
- une entité Doctrine ;
- une entité Hibernate ;
- une ligne SQL brute.

Le serveur DOIT utiliser des response DTO ou presenters.

---

# 5. Convention générale des URI

## 5.1 Base path

Convention recommandée :

```text
/api/v1
```

Exemples :

```text
/api/v1/accounts
/api/v1/projects
/api/v1/items/{itemId}
```

## 5.2 Nommage

Les URI DOIVENT :

- utiliser des noms ;
- utiliser le pluriel ;
- utiliser le kebab-case ;
- être en minuscules ;
- ne pas inclure d’extension.

Correct :

```text
/api/v1/access-policies
/api/v1/project-members
```

Incorrect :

```text
/api/v1/getPolicies
/api/v1/ProjectMembers
/api/v1/items.json
```

## 5.3 Identifiants

Les identifiants exposés DEVRAIENT être :

- UUID ;
- UUIDv7 ;
- CUID2 ;
- autre identifiant opaque.

Éviter les identifiants séquentiels lorsque leur exposition facilite l’énumération.

Un identifiant opaque NE REMPLACE PAS le contrôle d’autorisation objet.

## 5.4 Trailing slash

Choisir une seule convention.

Recommandation :

```text
/api/v1/items
```

sans slash final.

Le reverse proxy PEUT rediriger proprement une variante, mais l’API documentée doit rester unique.

---

# 6. Versionnement

## 6.1 Stratégie recommandée

Utiliser le versionnement majeur dans le chemin :

```text
/api/v1
/api/v2
```

Cette stratégie est :

- visible ;
- simple à router ;
- simple à documenter ;
- simple à mettre en cache ;
- facile à comprendre par les clients.

## 6.2 Ce qui exige une nouvelle version majeure

Créer `v2` lorsqu’un changement casse les clients existants :

- suppression d’un champ requis ;
- renommage d’un champ ;
- changement de type ;
- modification incompatible d’une enum ;
- modification du sens d’un champ ;
- changement du format d’erreur ;
- modification incompatible de pagination ;
- changement des règles d’authentification ;
- changement majeur de sémantique.

## 6.3 Changements compatibles dans la même version

Peuvent rester dans `v1` :

- ajout d’un champ optionnel ;
- ajout d’une route ;
- ajout d’un filtre optionnel ;
- ajout d’une valeur enum si les clients tolèrent les valeurs inconnues ;
- amélioration interne ;
- nouvel index ;
- modification de performance.

## 6.4 Interdictions

Ne pas utiliser :

```text
/v1.1
/v1.2
```

Ne pas versionner route par route sans stratégie globale.

Ne pas utiliser seulement un paramètre :

```text
?version=2
```

pour une API publique de production.

## 6.5 Coexistence

Deux versions majeures PEUVENT coexister pendant une période de migration.

L’organisation doit définir :

- date de dépréciation ;
- date de fin de support ;
- date de retrait ;
- guide de migration ;
- métriques d’usage par version.

---

# 7. Ressources et routes imbriquées

## 7.1 Quand imbriquer

Une route imbriquée est appropriée si la ressource enfant dépend naturellement du parent.

Exemple :

```text
GET /api/v1/projects/{projectId}/members
POST /api/v1/projects/{projectId}/members
```

## 7.2 Profondeur maximale

Recommandation :

- maximum deux niveaux métier ;
- éviter les routes excessivement profondes.

À éviter :

```text
/accounts/{accountId}/projects/{projectId}/members/{memberId}/permissions/{permissionId}
```

Préférer :

```text
/project-members/{memberId}/permissions
```

ou :

```text
/membership-permissions/{permissionId}
```

## 7.3 Identité canonique d’une ressource

Une ressource importante DEVRAIT disposer d’une URI canonique :

```text
GET /api/v1/members/{memberId}
```

Même si elle est créée via :

```text
POST /api/v1/projects/{projectId}/members
```

## 7.4 Tenant dans les URI

Dans un SaaS, ne pas exiger systématiquement :

```text
/tenants/{tenantId}/...
```

si le tenant est résolu par le contexte d’authentification.

Pour une route d’administration globale, un `tenantId` explicite PEUT être nécessaire.

Dans tous les cas, le serveur DOIT vérifier le tenant.

---

# 8. Méthodes HTTP

## 8.1 GET

Utilisation :

- lire une ressource ;
- lister des ressources ;
- rechercher.

GET DOIT être sûr et ne pas modifier l’état métier.

## 8.2 POST

Utilisation :

- créer une ressource ;
- déclencher une opération non idempotente ;
- créer une sous-ressource d’action ;
- lancer un job.

POST PEUT devenir idempotent via `Idempotency-Key`.

## 8.3 PUT

Utilisation :

- remplacement complet d’une ressource ;
- upsert explicite si documenté ;
- remplacement d’une collection enfant.

PUT est conceptuellement idempotent.

Le client DOIT envoyer la représentation complète attendue.

## 8.4 PATCH

Utilisation :

- modification partielle ;
- transition partielle ;
- mise à jour ciblée.

Le format du patch DOIT être explicite.

Options :

- merge patch ;
- JSON Patch ;
- DTO partiel métier.

Ne pas prétendre supporter JSON Patch si le backend accepte seulement un objet partiel arbitraire.

## 8.5 DELETE

Utilisation :

- suppression ;
- révocation ;
- annulation d’une relation.

DELETE est conceptuellement idempotent.

Une deuxième suppression PEUT retourner :

- `204` ;
- `404` ;
- `200` avec résultat idempotent.

La convention choisie DOIT être uniforme.

---

# 9. Codes de statut HTTP

## 9.1 Succès

| Code | Utilisation |
|---:|---|
| `200 OK` | Lecture ou modification avec réponse |
| `201 Created` | Ressource créée |
| `202 Accepted` | Traitement asynchrone accepté |
| `204 No Content` | Succès sans body |
| `206 Partial Content` | Réponses partielles HTTP Range, non pagination JSON standard |

## 9.2 Redirections

| Code | Utilisation |
|---:|---|
| `301` | Déplacement permanent, rare pour API |
| `307` | Redirection temporaire conservant méthode/body |
| `308` | Redirection permanente conservant méthode/body |

Éviter les redirections implicites sur les mutations.

## 9.3 Erreurs client

| Code | Utilisation |
|---:|---|
| `400 Bad Request` | Syntaxe, paramètres ou body invalides |
| `401 Unauthorized` | Authentification absente ou invalide |
| `403 Forbidden` | Authentifié mais non autorisé |
| `404 Not Found` | Ressource absente ou masquée |
| `405 Method Not Allowed` | Méthode non supportée |
| `406 Not Acceptable` | Représentation demandée non supportée |
| `409 Conflict` | Conflit d’état ou concurrence |
| `410 Gone` | Ressource définitivement retirée |
| `412 Precondition Failed` | `If-Match` ou autre précondition invalide |
| `413 Content Too Large` | Payload trop volumineux |
| `415 Unsupported Media Type` | Content-Type non supporté |
| `422 Unprocessable Content` | Données syntaxiquement valides mais non traitables |
| `428 Precondition Required` | Précondition obligatoire absente |
| `429 Too Many Requests` | Rate limit |

## 9.4 Erreurs serveur

| Code | Utilisation |
|---:|---|
| `500 Internal Server Error` | Erreur inattendue |
| `502 Bad Gateway` | Dépendance amont invalide |
| `503 Service Unavailable` | Service temporairement indisponible |
| `504 Gateway Timeout` | Dépendance expirée |

## 9.5 Règles

- Ne pas retourner `200` avec une erreur métier cachée.
- Ne pas retourner `500` pour une validation client.
- Ne pas utiliser `401` pour une permission insuffisante.
- Ne pas exposer une stack trace.
- Une ressource d’un autre tenant PEUT retourner `404` pour éviter la fuite d’existence.

---

# 10. Format uniforme des réponses

## 10.1 Succès avec ressource

```json
{
  "data": {
    "id": "itm_01JXYZ",
    "name": "Example item",
    "status": "ACTIVE",
    "createdAt": "2026-07-28T12:00:00.000Z"
  },
  "meta": {
    "requestId": "req_01JABC",
    "timestamp": "2026-07-28T12:00:00.050Z",
    "apiVersion": "v1"
  },
  "error": null
}
```

## 10.2 Succès avec collection

```json
{
  "data": [
    {
      "id": "itm_01",
      "name": "Item A"
    },
    {
      "id": "itm_02",
      "name": "Item B"
    }
  ],
  "meta": {
    "requestId": "req_01JABC",
    "timestamp": "2026-07-28T12:00:00.050Z",
    "apiVersion": "v1",
    "pagination": {
      "limit": 20,
      "hasNextPage": true,
      "hasPreviousPage": false,
      "nextCursor": "opaque-cursor",
      "previousCursor": null
    }
  },
  "error": null
}
```

## 10.3 Création

La réponse `201` DEVRAIT inclure :

```http
Location: /api/v1/items/itm_01JXYZ
```

et le body :

```json
{
  "data": {
    "id": "itm_01JXYZ",
    "name": "Example item"
  },
  "meta": {
    "requestId": "req_01JABC",
    "timestamp": "2026-07-28T12:00:00.050Z",
    "apiVersion": "v1"
  },
  "error": null
}
```

## 10.4 Action sans représentation

Deux conventions acceptables :

### Convention A — `204`

Aucun body.

### Convention B — `200`

```json
{
  "data": null,
  "meta": {
    "requestId": "req_01JABC",
    "timestamp": "2026-07-28T12:00:00.050Z",
    "apiVersion": "v1"
  },
  "error": null
}
```

Pour une API appliquant strictement `data/meta/error`, la convention B est souvent plus uniforme.

---

# 11. Format uniforme des erreurs

## 11.1 Structure canonique

```json
{
  "data": null,
  "meta": {
    "requestId": "req_01JABC",
    "timestamp": "2026-07-28T12:00:00.050Z",
    "apiVersion": "v1"
  },
  "error": {
    "type": "https://errors.example.invalid/validation-error",
    "title": "Validation failed",
    "status": 400,
    "code": "VALIDATION_ERROR",
    "detail": "One or more fields are invalid.",
    "instance": "/api/v1/items",
    "errors": [
      {
        "field": "name",
        "code": "REQUIRED",
        "message": "The name field is required."
      }
    ],
    "retryable": false
  }
}
```

Cette forme reprend les concepts de Problem Details tout en conservant l’enveloppe uniforme.

## 11.2 Champs

| Champ | Rôle |
|---|---|
| `type` | Identifiant stable du type de problème |
| `title` | Résumé humain stable |
| `status` | Code HTTP |
| `code` | Code métier machine-readable |
| `detail` | Détail spécifique à l’occurrence |
| `instance` | URI de la requête ou occurrence |
| `errors` | Erreurs de champs |
| `retryable` | Indique si un retry est raisonnable |

## 11.3 Codes métier

Les codes DOIVENT être :

- stables ;
- documentés ;
- indépendants du message ;
- en `UPPER_SNAKE_CASE`.

Exemples :

```text
VALIDATION_ERROR
RESOURCE_NOT_FOUND
RESOURCE_ALREADY_EXISTS
VERSION_CONFLICT
IDEMPOTENCY_CONFLICT
RATE_LIMIT_EXCEEDED
AUTHENTICATION_REQUIRED
PERMISSION_DENIED
TENANT_ACCESS_DENIED
DEPENDENCY_UNAVAILABLE
```

## 11.4 Sécurité

Les erreurs NE DOIVENT PAS révéler :

- SQL ;
- nom de table ;
- stack trace ;
- chemin du serveur ;
- secret ;
- existence d’un compte public ;
- détail d’un token ;
- règle interne sensible.

---

# 12. Métadonnées de réponse

## 12.1 Champs recommandés

```json
{
  "meta": {
    "requestId": "req_01JABC",
    "timestamp": "2026-07-28T12:00:00.050Z",
    "apiVersion": "v1"
  }
}
```

## 12.2 Métadonnées optionnelles

- `pagination` ;
- `sort` ;
- `filters` ;
- `warnings` ;
- `deprecation` ;
- `job` ;
- `cache`.

## 12.3 Interdictions

Ne pas placer dans `meta` :

- données métier principales ;
- permissions sensibles ;
- secrets ;
- informations personnelles inutiles ;
- état complet d’autorisation.

---

# 13. Pagination par curseur

## 13.1 Pourquoi

La pagination curseur est recommandée pour :

- grandes tables ;
- flux actifs ;
- données fréquemment ajoutées ;
- historiques ;
- audit logs ;
- activités ;
- événements temps réel.

Elle évite plusieurs problèmes de `OFFSET` :

- performances dégradées ;
- doublons ;
- éléments sautés ;
- résultats instables.

## 13.2 Paramètres

```text
limit
after
before
```

Première page :

```http
GET /api/v1/items?limit=20
```

Page suivante :

```http
GET /api/v1/items?limit=20&after=<opaque-cursor>
```

Page précédente :

```http
GET /api/v1/items?limit=20&before=<opaque-cursor>
```

## 13.3 Règles

- `after` et `before` NE DOIVENT PAS être utilisés ensemble.
- `limit` DOIT avoir une valeur par défaut.
- `limit` DOIT avoir une limite maximale.
- Le curseur DOIT être opaque.
- Le curseur DEVRAIT être signé.
- Le curseur DOIT correspondre au tri.
- Le tri DOIT être déterministe.

## 13.4 Exemple de contenu interne

```json
{
  "sortValue": "2026-07-28T10:00:00.000Z",
  "id": "itm_01JXYZ",
  "direction": "after",
  "sortBy": "createdAt",
  "sortOrder": "desc"
}
```

Le client ne doit pas dépendre de cette structure.

## 13.5 Tie-breaker

Le tri :

```text
createdAt DESC
```

n’est pas suffisant.

Utiliser :

```text
createdAt DESC, id DESC
```

L’identifiant garantit un ordre stable.

## 13.6 Réponse

```json
{
  "meta": {
    "pagination": {
      "limit": 20,
      "hasNextPage": true,
      "hasPreviousPage": false,
      "nextCursor": "eyJ...",
      "previousCursor": null
    }
  }
}
```

## 13.7 Calcul de `hasNextPage`

Technique recommandée :

- demander `limit + 1` lignes ;
- retourner seulement `limit` ;
- si la ligne supplémentaire existe, `hasNextPage = true`.

## 13.8 `totalCount`

`totalCount` NE DEVRAIT PAS être calculé par défaut.

Il peut être :

- coûteux ;
- lent ;
- inutile pour infinite scroll ;
- incohérent avec une liste très active.

Créer un endpoint de statistiques séparé si nécessaire.

---

# 14. Pagination précédente et suivante

## 14.1 Page suivante

Pour :

```text
ORDER BY created_at DESC, id DESC
```

la condition conceptuelle est :

```text
created_at < cursor.created_at
OR (
  created_at = cursor.created_at
  AND id < cursor.id
)
```

## 14.2 Page précédente

Pour `before` :

1. inverser le sens de comparaison ;
2. récupérer `limit + 1` ;
3. inverser le résultat avant réponse ;
4. générer les deux curseurs.

## 14.3 Curseurs et filtres

Un curseur DOIT être invalidé si le client change :

- le tri ;
- les filtres ;
- le tenant ;
- le scope ;
- la recherche.

Le curseur PEUT embarquer un hash canonique des paramètres.

## 14.4 Expiration

Les curseurs PEUVENT avoir une durée de vie.

Une expiration est utile si :

- les règles changent ;
- les données sont sensibles ;
- le curseur contient un contexte signé ;
- les clients ne doivent pas réutiliser des liens anciens.

---

# 15. Tri

## 15.1 Paramètres

Convention recommandée :

```text
sortBy=createdAt
sortOrder=desc
```

## 15.2 Allowlist

Le backend DOIT utiliser une allowlist :

```text
createdAt
updatedAt
name
status
```

Le client NE DOIT PAS pouvoir fournir un nom de colonne SQL libre.

## 15.3 Valeurs

```text
asc
desc
```

Toute autre valeur doit être rejetée.

## 15.4 Tri par défaut

Chaque collection DOIT avoir un tri par défaut documenté et déterministe.

Exemple :

```text
createdAt DESC, id DESC
```

---

# 16. Filtrage

## 16.1 Paramètres simples

```text
status=ACTIVE
type=STANDARD
createdFrom=2026-01-01T00:00:00Z
createdTo=2026-12-31T23:59:59Z
```

## 16.2 Filtres multiples

Deux conventions possibles :

```text
status=ACTIVE&status=PENDING
```

ou :

```text
status=ACTIVE,PENDING
```

Choisir une convention unique.

## 16.3 Validation

Tous les filtres DOIVENT être :

- déclarés ;
- typés ;
- bornés ;
- documentés ;
- compatibles avec l’autorisation.

## 16.4 Tenant

Un filtre `tenantId` ne doit être accepté que pour un acteur global autorisé.

Un client tenant-scoped ne doit pas changer son tenant par simple query parameter.

---

# 17. Recherche

## 17.1 Paramètre

```text
search=<text>
```

## 17.2 Limites

Le serveur DOIT limiter :

- longueur minimale ;
- longueur maximale ;
- caractères ;
- coût ;
- nombre de champs.

## 17.3 Sémantique

La documentation DOIT préciser :

- champs recherchés ;
- sensibilité à la casse ;
- préfixe ou contains ;
- langue ;
- ranking éventuel.

## 17.4 Sécurité

Ne pas concaténer le texte dans une requête SQL brute.

Utiliser :

- ORM paramétré ;
- moteur de recherche ;
- SQL paramétré.

---

# 18. Sélection et expansion des champs

## 18.1 Sélection

Option possible :

```text
fields=id,name,status
```

À utiliser uniquement si la complexité est justifiée.

## 18.2 Expansion

Option possible :

```text
include=owner,tags
```

## 18.3 Risques

- exposition excessive ;
- N+1 ;
- coûts imprévisibles ;
- contournement de property-level authorization.

Utiliser des allowlists.

Le serveur DOIT appliquer l’autorisation sur chaque relation incluse.

---

# 19. Idempotence

## 19.1 Objectif

L’idempotence permet à un client de répéter une requête sans créer plusieurs effets métier.

Cas typiques :

- création ;
- paiement ;
- réservation ;
- import ;
- lancement de job ;
- synchronisation offline ;
- webhook entrant.

## 19.2 Header

```http
Idempotency-Key: 01JXYZ...
```

La clé DOIT être :

- unique par intention ;
- suffisamment aléatoire ;
- limitée en taille ;
- non sensible.

## 19.3 Scope

La clé DOIT être scindée au minimum par :

```text
tenant
acteur/client
méthode
route canonique
idempotency key
```

Une même clé dans deux tenants ne doit pas entrer en conflit.

## 19.4 Empreinte de requête

Le serveur DOIT calculer un hash canonique de :

- méthode ;
- route ;
- body ;
- paramètres métier pertinents ;
- tenant.

## 19.5 États

Un enregistrement peut avoir :

```text
PENDING
COMPLETED
FAILED_RETRYABLE
FAILED_FINAL
EXPIRED
```

## 19.6 Première requête

1. valider la clé ;
2. calculer l’empreinte ;
3. réserver atomiquement la clé ;
4. exécuter l’opération ;
5. conserver le statut et la réponse ;
6. retourner le résultat.

## 19.7 Retry identique

Si la clé et l’empreinte sont identiques :

- retourner la réponse enregistrée ;
- conserver le même résultat logique ;
- indiquer éventuellement un replay dans `meta`.

## 19.8 Même clé, body différent

Retourner :

```text
409 Conflict
```

avec :

```json
{
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "detail": "The idempotency key was already used with a different request."
  }
}
```

## 19.9 Requête en cours

Options :

- attendre brièvement ;
- retourner `409` ;
- retourner `425` si la politique le justifie ;
- retourner `202` avec l’état du job.

La convention doit être documentée.

## 19.10 Durée de rétention

La durée dépend du domaine.

Exemples génériques :

- quelques heures ;
- 24 heures ;
- plusieurs jours pour opérations financières.

## 19.11 Stockage

L’enregistrement recommandé contient :

```text
idempotency_key
tenant_id
actor_id
method
route
request_hash
status
response_status
response_body_or_reference
created_at
expires_at
locked_until
```

## 19.12 Contraintes

L’unicité DOIT être garantie par la base ou un mécanisme atomique équivalent.

Un simple `find then insert` est vulnérable à la concurrence.

---

# 20. Contrôle de concurrence

## 20.1 Problème

Deux clients peuvent lire la même version puis modifier la même ressource.

Sans contrôle, le dernier écrase le premier.

## 20.2 Stratégie A — Version métier

Ressource :

```json
{
  "id": "itm_01",
  "name": "Example",
  "version": 7
}
```

Modification :

```json
{
  "name": "Updated",
  "version": 7
}
```

Mise à jour conditionnelle :

```text
WHERE id = ?
AND version = 7
```

Puis :

```text
version = 8
```

En cas de conflit :

```text
409 Conflict
```

## 20.3 Stratégie B — ETag / If-Match

Réponse :

```http
ETag: "item-01-v7"
```

Requête :

```http
If-Match: "item-01-v7"
```

Si l’ETag ne correspond plus :

```text
412 Precondition Failed
```

## 20.4 Précondition obligatoire

Pour les ressources critiques, le serveur PEUT exiger `If-Match`.

Si absent :

```text
428 Precondition Required
```

## 20.5 Choix recommandé

- utiliser `version` en interne ;
- exposer ETag si les clients HTTP en bénéficient ;
- ne pas mélanger des règles contradictoires ;
- documenter le code d’erreur.

## 20.6 Transactions

Le contrôle optimiste ne remplace pas les transactions.

Utiliser une transaction pour :

- plusieurs écritures atomiques ;
- invariants ;
- réservation ;
- changement d’état ;
- audit durable.

## 20.7 Verrou pessimiste

Réserver aux cas qui le justifient :

- forte contention ;
- ressource unique ;
- fenêtre courte ;
- transition critique.

Éviter les transactions longues.

---

# 21. Rate limiting

## 21.1 Objectifs

Le rate limiting protège :

- disponibilité ;
- coûts ;
- login ;
- reset ;
- recherche ;
- exports ;
- endpoints coûteux ;
- flux sensibles.

## 21.2 Dimensions

Une politique peut limiter par :

- IP ;
- utilisateur ;
- client API ;
- tenant ;
- route ;
- ressource ;
- combinaison IP + utilisateur ;
- appareil ;
- clé API.

## 21.3 Algorithmes

Options :

- fixed window ;
- sliding window ;
- token bucket ;
- leaky bucket ;
- GCRA.

Token bucket ou sliding window sont souvent adaptés aux APIs SaaS.

## 21.4 Politique hiérarchique

Exemple :

```text
Global platform
+ tenant
+ user
+ route
+ operation
```

La limite la plus restrictive s’applique.

## 21.5 Réponse 429

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 30
```

Body :

```json
{
  "data": null,
  "meta": {
    "requestId": "req_01"
  },
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "status": 429,
    "detail": "Too many requests.",
    "retryable": true
  }
}
```

## 21.6 Headers de quota

Les headers de type :

```text
RateLimit-Limit
RateLimit-Remaining
RateLimit-Reset
```

peuvent être exposés selon la convention retenue.

Le standard correspondant a longtemps évolué comme Internet-Draft ; l’implémentation doit vérifier la version retenue par l’organisation et ne pas prétendre à une conformité RFC inexistante ou incorrecte.

`Retry-After` reste le mécanisme HTTP essentiel lors d’un `429`.

## 21.7 Sécurité

Les valeurs exposées NE DOIVENT PAS faciliter :

- reconnaissance de capacité ;
- synchronisation massive de retries ;
- attaque coordonnée.

Ajouter du jitter côté clients et éventuellement côté serveur.

## 21.8 Multi-instance

Le rate limiting distribué doit utiliser un store partagé tel que Redis.

Une limite uniquement en mémoire par instance est insuffisante.

## 21.9 Fail mode

Pour les endpoints critiques :

- déterminer si Redis indisponible implique fail closed ;
- ou appliquer une limite locale dégradée.

La décision doit être documentée.

---

# 22. Headers standards

## 22.1 Requête

| Header | Utilisation |
|---|---|
| `Accept` | Type de réponse accepté |
| `Content-Type` | Type du body |
| `Authorization` | Credentials Bearer lorsque applicable |
| `Idempotency-Key` | Déduplication d’une mutation |
| `If-Match` | Concurrence optimiste |
| `If-None-Match` | Cache conditionnel |
| `Prefer` | Préférence client documentée |
| `traceparent` | Contexte de trace distribué |
| `X-Request-Id` | Request ID externe accepté sous contrôle |

## 22.2 Réponse

| Header | Utilisation |
|---|---|
| `Content-Type` | Type de réponse |
| `Location` | URI de ressource créée |
| `ETag` | Version de représentation |
| `Cache-Control` | Politique de cache |
| `Retry-After` | Attente avant retry |
| `Link` | Liens typés |
| `Deprecation` | Dépréciation |
| `Sunset` | Date de retrait |
| `traceparent` | Trace |
| `X-Request-Id` | Corrélation |

## 22.3 Headers personnalisés

Éviter les headers `X-*` lorsque des standards existent.

Les headers métier personnalisés doivent être rares et documentés.

---

# 23. Headers de sécurité

## 23.1 Réponses navigateur

Selon le contexte :

```text
Strict-Transport-Security
Content-Security-Policy
X-Content-Type-Options
Referrer-Policy
Permissions-Policy
```

## 23.2 CORS

Configurer explicitement :

```text
Access-Control-Allow-Origin
Access-Control-Allow-Credentials
Access-Control-Allow-Methods
Access-Control-Allow-Headers
Access-Control-Expose-Headers
```

Ne jamais combiner :

```text
Access-Control-Allow-Origin: *
```

avec credentials.

## 23.3 CSRF

Toute mutation authentifiée par cookies doit être protégée par :

- token CSRF ;
- SameSite ;
- Origin ;
- CORS strict.

---

# 24. Headers d’observabilité

## 24.1 Request ID

Chaque requête DOIT avoir un request ID.

Recommandation :

```http
X-Request-Id: req_01J...
```

Le serveur :

- accepte un ID client seulement s’il est valide ;
- peut le remplacer ;
- en génère un sinon ;
- le retourne ;
- le loggue.

## 24.2 Trace Context

Utiliser :

```http
traceparent: 00-...
tracestate: ...
```

pour l’interopérabilité de tracing.

## 24.3 Corrélation

Les logs doivent inclure :

- requestId ;
- traceId ;
- spanId ;
- tenantId ;
- userId si connu ;
- route template ;
- status.

Ne pas mettre d’identifiants personnels dans les métriques haute cardinalité.

---

# 25. Authentification et autorisation

## 25.1 Séparation

Authentification :

```text
Qui appelle ?
```

Autorisation :

```text
Peut-il effectuer cette action sur cette ressource ?
```

## 25.2 Contrôles

Pour chaque ressource identifiée par ID :

1. authentifier ;
2. résoudre le tenant ;
3. charger la ressource dans le tenant ;
4. vérifier le rôle ;
5. vérifier la permission ;
6. vérifier la propriété ou policy ;
7. appliquer les field-level permissions.

## 25.3 BOLA/IDOR

Ne jamais faire uniquement :

```text
findById(resourceId)
```

dans un contexte multi-tenant.

Effectuer conceptuellement :

```text
find where
id = resourceId
and tenant_id = tenantContext.id
```

## 25.4 Property-level authorization

Le serveur doit contrôler :

- champs lisibles ;
- champs modifiables ;
- champs réservés ;
- champs calculés.

Le DTO de réponse peut dépendre des permissions, mais le comportement doit être documenté.

---

# 26. Multi-tenancy

## 26.1 Tenant context

Le tenant doit être résolu depuis une source fiable :

- session ;
- token vérifié ;
- mapping de domaine ;
- route globale protégée.

## 26.2 Interdictions

Ne jamais faire confiance directement à :

- `tenantId` du body ;
- `organizationId` de la query ;
- header libre non signé ;
- état frontend.

## 26.3 Repositories

Les repositories tenant-scoped DEVRAIENT exiger le contexte tenant dans leur interface.

Exemple conceptuel :

```text
findById(tenantContext, resourceId)
```

plutôt que :

```text
findById(resourceId)
```

## 26.4 Index

Les index des tables multi-tenant devraient souvent commencer par :

```text
tenant_id
```

## 26.5 Erreurs

Une ressource d’un autre tenant peut retourner `404`.

Cela réduit la fuite d’existence.

---

# 27. Validation des entrées

## 27.1 Validation structurelle

Valider :

- types ;
- champs obligatoires ;
- formats ;
- tailles ;
- enums ;
- dates ;
- UUID ;
- tableaux ;
- objets imbriqués.

## 27.2 Whitelist

Rejeter les propriétés inconnues lorsque possible.

Exemple :

```json
{
  "name": "Valid",
  "isSuperAdmin": true
}
```

Le champ inattendu doit être rejeté ou ignoré selon une politique explicite.

Recommandation sécurité :

- rejeter sur les commandes sensibles.

## 27.3 Normalisation

Normaliser uniquement lorsque la sémantique est claire :

- trim ;
- email ;
- Unicode ;
- casse.

Ne pas normaliser silencieusement des identifiants sensibles.

## 27.4 Bornes

Chaque champ doit avoir :

- longueur maximale ;
- nombre maximal d’éléments ;
- profondeur maximale ;
- taille de body maximale.

---

# 28. Protection contre le mass assignment

## 28.1 Risque

Le client peut ajouter des champs sensibles :

```json
{
  "name": "Example",
  "status": "APPROVED",
  "ownerId": "another-user",
  "tenantId": "another-tenant"
}
```

## 28.2 Règles

- DTO explicite par use case ;
- mapping manuel ou contrôlé ;
- ne jamais passer le body entier à l’ORM ;
- séparer DTO de création et DTO admin ;
- ignorer les colonnes calculées ;
- contrôler les champs par permission.

---

# 29. Limites de ressources

Chaque route doit documenter :

- taille max body ;
- nombre max d’items ;
- longueur max recherche ;
- nombre max de filtres ;
- profondeur max JSON ;
- timeout ;
- limite de fichier ;
- coût estimé.

Pour les opérations coûteuses :

- utiliser un job ;
- imposer un quota ;
- limiter la concurrence ;
- appliquer un timeout.

---

# 30. Traitements asynchrones

## 30.1 Quand utiliser `202`

Utiliser pour :

- import ;
- export ;
- rapport ;
- traitement long ;
- génération ;
- bulk operation.

## 30.2 Réponse

```http
HTTP/1.1 202 Accepted
Location: /api/v1/jobs/job_01
```

```json
{
  "data": {
    "jobId": "job_01",
    "status": "QUEUED",
    "statusUrl": "/api/v1/jobs/job_01"
  },
  "meta": {
    "requestId": "req_01"
  },
  "error": null
}
```

## 30.3 Endpoint job

```text
GET /api/v1/jobs/{jobId}
```

Réponse :

```json
{
  "data": {
    "id": "job_01",
    "status": "PROCESSING",
    "progress": {
      "completed": 420,
      "total": 1000,
      "percentage": 42
    }
  },
  "meta": {},
  "error": null
}
```

## 30.4 Statuts

```text
QUEUED
PROCESSING
SUCCEEDED
FAILED
CANCELLED
EXPIRED
```

## 30.5 Idempotence

La création d’un job devrait supporter `Idempotency-Key`.

---

# 31. Imports, exports et fichiers

## 31.1 Upload

Valider :

- content type déclaré ;
- signature réelle ;
- taille ;
- extension ;
- nom ;
- contenu ;
- antivirus selon risque ;
- archive bomb ;
- nombre de lignes.

## 31.2 Imports

Workflow recommandé :

1. upload ;
2. validation ;
3. prévisualisation ;
4. confirmation ;
5. job ;
6. rapport.

## 31.3 Exports

Ne pas renvoyer un fichier volumineux dans une enveloppe JSON.

Options :

- streaming ;
- URL signée courte ;
- stockage objet ;
- job asynchrone.

## 31.4 Content-Disposition

Pour téléchargement :

```http
Content-Disposition: attachment; filename="export.csv"
```

---

# 32. Webhooks

## 32.1 Sortants

Chaque webhook doit inclure :

- event ID ;
- type ;
- timestamp ;
- version ;
- payload ;
- signature.

## 32.2 Signature

Utiliser une signature HMAC avec timestamp.

Le consommateur doit vérifier :

- signature ;
- timestamp ;
- tolérance temporelle ;
- event ID non traité.

## 32.3 Retries

Définir :

- backoff ;
- nombre maximal ;
- dead-letter ;
- timeout ;
- codes considérés retryables.

## 32.4 Idempotence

Le destinataire doit dédupliquer avec l’event ID.

## 32.5 Entrants

Ne jamais faire confiance au body sans vérifier :

- signature ;
- source ;
- timestamp ;
- replay ;
- taille ;
- schéma.

---

# 33. Caching HTTP

## 33.1 Réponses privées

Pour données sensibles :

```http
Cache-Control: private, no-store
```

selon le besoin.

## 33.2 Ressources cacheables

Utiliser :

```text
ETag
If-None-Match
Cache-Control
Last-Modified
If-Modified-Since
```

## 33.3 304

Si représentation inchangée :

```text
304 Not Modified
```

sans body complet.

## 33.4 Mutations

Après mutation, invalider ou versionner correctement les caches.

Ne pas cacher une réponse tenant A pour tenant B.

Le cache key doit inclure le contexte d’autorisation approprié.

---

# 34. Dépréciation et fin de vie

## 34.1 Étapes

1. annoncer ;
2. documenter ;
3. exposer les headers ;
4. mesurer l’usage ;
5. fournir migration ;
6. retirer à la date annoncée.

## 34.2 Headers

```http
Deprecation: @<unix-timestamp>
Sunset: Wed, 31 Dec 2027 23:59:59 GMT
Link: </docs/migration>; rel="deprecation"
```

## 34.3 Règles

- la dépréciation ne doit pas changer silencieusement la sémantique ;
- la date Sunset doit être ultérieure ou égale à la dépréciation ;
- le client doit avoir une période de migration raisonnable ;
- l’usage de l’ancienne version doit être mesuré.

---

# 35. Documentation OpenAPI

## 35.1 Baseline

Documenter l’API avec OpenAPI.

OpenAPI 3.1 reste une baseline largement compatible ; OpenAPI 3.2 peut être adopté lorsque l’ensemble de la chaîne d’outils le supporte correctement.

## 35.2 Chaque opération doit inclure

- `operationId` stable ;
- résumé ;
- description ;
- tags ;
- sécurité ;
- paramètres ;
- body ;
- réponses ;
- erreurs ;
- headers ;
- exemples ;
- rate limit ;
- idempotence ;
- concurrence.

## 35.3 Schémas partagés

Définir :

- envelope succès ;
- envelope erreur ;
- pagination ;
- validation errors ;
- job status ;
- security schemes.

## 35.4 Exemples

Chaque route critique doit fournir :

- succès ;
- validation ;
- non authentifié ;
- interdit ;
- conflit ;
- rate limit.

## 35.5 CI

La CI doit :

- valider le document ;
- détecter les breaking changes ;
- générer ou tester les clients ;
- comparer implémentation et contrat.

---

# 36. Journalisation

## 36.1 Logs structurés

Format JSON recommandé.

Champs :

```text
timestamp
level
service
environment
requestId
traceId
route
method
statusCode
durationMs
tenantId
userId
clientId
errorCode
```

## 36.2 Données interdites

Ne jamais logguer :

- mot de passe ;
- Authorization ;
- Cookie ;
- refresh token ;
- API key ;
- secret webhook ;
- données personnelles inutiles ;
- body complet par défaut.

## 36.3 Route template

Logguer :

```text
/api/v1/items/:id
```

pas chaque URI concrète comme label métrique.

---

# 37. Métriques et traces

## 37.1 Métriques minimales

- nombre de requêtes ;
- latence p50/p95/p99 ;
- erreurs 4xx ;
- erreurs 5xx ;
- rate limits ;
- timeouts ;
- jobs ;
- dépendances ;
- saturation.

## 37.2 Labels

Labels recommandés :

- service ;
- route template ;
- méthode ;
- statut ;
- environnement.

Éviter :

- userId ;
- tenantId si cardinalité élevée ;
- requestId ;
- resourceId.

## 37.3 Tracing

Tracer :

- entrée HTTP ;
- base de données ;
- Redis ;
- queues ;
- HTTP externe ;
- webhook.

Propager `traceparent`.

---

# 38. Sécurité API

## 38.1 Contrôles prioritaires

- object-level authorization ;
- authentication ;
- property-level authorization ;
- resource consumption ;
- function-level authorization ;
- protection des business flows ;
- SSRF ;
- configuration ;
- inventaire ;
- validation des APIs tierces.

## 38.2 SSRF

Pour les URLs fournies par client :

- allowlist ;
- DNS resolution contrôlée ;
- blocage localhost ;
- blocage réseaux privés ;
- protocoles autorisés ;
- timeout ;
- taille max ;
- redirections limitées.

## 38.3 Dépendances externes

Ne jamais faire confiance automatiquement à une API tierce.

Valider :

- schéma ;
- taille ;
- timeout ;
- content type ;
- status ;
- signature si applicable.

## 38.4 Inventaire

Chaque API doit avoir :

- propriétaire ;
- version ;
- environnement ;
- classification ;
- date de dépréciation ;
- exposition ;
- authentification ;
- documentation.

---

# 39. Exemples génériques complets

## 39.1 Création idempotente

### Requête

```http
POST /api/v1/items HTTP/1.1
Content-Type: application/json
Accept: application/json
Idempotency-Key: 01JABCDEF
X-Request-Id: req-client-01

{
  "name": "Example item",
  "type": "STANDARD"
}
```

### Réponse

```http
HTTP/1.1 201 Created
Location: /api/v1/items/itm_01
Content-Type: application/json
X-Request-Id: req-client-01
ETag: "itm_01-v1"
```

```json
{
  "data": {
    "id": "itm_01",
    "name": "Example item",
    "type": "STANDARD",
    "version": 1
  },
  "meta": {
    "requestId": "req-client-01",
    "timestamp": "2026-07-28T12:00:00.000Z",
    "apiVersion": "v1",
    "idempotency": {
      "replayed": false
    }
  },
  "error": null
}
```

## 39.2 Replay idempotent

Même requête, même clé, même body :

```json
{
  "data": {
    "id": "itm_01",
    "name": "Example item",
    "type": "STANDARD",
    "version": 1
  },
  "meta": {
    "requestId": "req-client-02",
    "idempotency": {
      "replayed": true,
      "originalRequestId": "req-client-01"
    }
  },
  "error": null
}
```

## 39.3 Conflit idempotence

Même clé, body différent :

```http
HTTP/1.1 409 Conflict
```

```json
{
  "data": null,
  "meta": {
    "requestId": "req-02"
  },
  "error": {
    "code": "IDEMPOTENCY_CONFLICT",
    "status": 409,
    "detail": "This key was already used with a different request.",
    "retryable": false
  }
}
```

## 39.4 Mise à jour avec ETag

### Requête

```http
PATCH /api/v1/items/itm_01
Content-Type: application/json
If-Match: "itm_01-v1"

{
  "name": "Updated name"
}
```

### Succès

```http
HTTP/1.1 200 OK
ETag: "itm_01-v2"
```

### Conflit

```http
HTTP/1.1 412 Precondition Failed
```

```json
{
  "data": null,
  "meta": {
    "requestId": "req-03"
  },
  "error": {
    "code": "PRECONDITION_FAILED",
    "status": 412,
    "detail": "The resource has changed since it was read.",
    "retryable": false
  }
}
```

## 39.5 Collection paginée

### Requête

```http
GET /api/v1/items?limit=20&status=ACTIVE&sortBy=createdAt&sortOrder=desc
```

### Réponse

```json
{
  "data": [
    {
      "id": "itm_10",
      "name": "Item 10",
      "status": "ACTIVE"
    }
  ],
  "meta": {
    "requestId": "req-04",
    "timestamp": "2026-07-28T12:00:00.000Z",
    "apiVersion": "v1",
    "pagination": {
      "limit": 20,
      "hasNextPage": true,
      "hasPreviousPage": false,
      "nextCursor": "opaque-next",
      "previousCursor": null
    },
    "sort": {
      "field": "createdAt",
      "direction": "desc"
    },
    "filters": {
      "status": ["ACTIVE"]
    }
  },
  "error": null
}
```

## 39.6 Job asynchrone

### Requête

```http
POST /api/v1/exports
Idempotency-Key: 01JEXPORT
Content-Type: application/json

{
  "format": "CSV",
  "filters": {
    "status": "ACTIVE"
  }
}
```

### Réponse

```http
HTTP/1.1 202 Accepted
Location: /api/v1/jobs/job_01
```

```json
{
  "data": {
    "jobId": "job_01",
    "status": "QUEUED",
    "statusUrl": "/api/v1/jobs/job_01"
  },
  "meta": {
    "requestId": "req-05"
  },
  "error": null
}
```

---

# 40. Tests obligatoires

## 40.1 Contrat

- chaque réponse respecte l’enveloppe ;
- chaque erreur contient un code ;
- chaque route respecte OpenAPI ;
- aucun champ interne n’est exposé.

## 40.2 Codes HTTP

Tester chaque code documenté :

- 200 ;
- 201 ;
- 202 ;
- 400 ;
- 401 ;
- 403 ;
- 404 ;
- 409 ;
- 412 ;
- 413 ;
- 415 ;
- 422 ;
- 428 ;
- 429 ;
- 500 ;
- 503.

## 40.3 Pagination

- première page ;
- page suivante ;
- page précédente ;
- égalité du champ de tri ;
- suppression entre deux pages ;
- insertion entre deux pages ;
- curseur invalide ;
- curseur signé modifié ;
- changement de filtre ;
- `after + before` rejeté ;
- limite max.

## 40.4 Idempotence

- première requête ;
- replay identique ;
- même clé body différent ;
- requêtes concurrentes ;
- expiration ;
- tenant différent ;
- acteur différent ;
- erreur finale ;
- erreur retryable ;
- crash entre réservation et résultat.

## 40.5 Concurrence

- version correcte ;
- version obsolète ;
- ETag correct ;
- If-Match absent ;
- mises à jour concurrentes ;
- transaction rollback.

## 40.6 Rate limiting

- sous la limite ;
- limite atteinte ;
- `429` ;
- `Retry-After` ;
- multi-instance ;
- clés par tenant ;
- clés par user ;
- Redis indisponible ;
- jitter/retry client.

## 40.7 Sécurité

- objet autre tenant ;
- rôle insuffisant ;
- propriété non modifiable ;
- body avec champ inattendu ;
- payload trop grand ;
- content type incorrect ;
- SSRF ;
- injection ;
- données sensibles dans les logs ;
- CORS ;
- CSRF si cookies.

## 40.8 Observabilité

- request ID ;
- trace propagation ;
- logs structurés ;
- métriques route template ;
- aucun secret ;
- erreur corrélable.

---

# 41. Architecture backend recommandée

```text
src/
├── modules/
│   └── resource/
│       ├── controllers/
│       ├── application/
│       ├── domain/
│       ├── infrastructure/
│       ├── dto/
│       ├── presenters/
│       └── index.ts
├── common/
│   ├── api/
│   │   ├── response-envelope/
│   │   ├── errors/
│   │   ├── pagination/
│   │   ├── idempotency/
│   │   ├── concurrency/
│   │   ├── rate-limiting/
│   │   ├── headers/
│   │   └── versioning/
│   ├── guards/
│   ├── interceptors/
│   ├── filters/
│   ├── pipes/
│   └── middleware/
├── infrastructure/
│   ├── database/
│   ├── redis/
│   ├── queue/
│   ├── logging/
│   ├── tracing/
│   └── metrics/
└── config/
```

## 41.1 Contrôleurs

Les contrôleurs doivent :

- recevoir ;
- valider ;
- déléguer ;
- mapper ;
- retourner.

Ils ne doivent pas :

- appeler directement l’ORM ;
- contenir la logique métier ;
- calculer les permissions complexes ;
- construire des SQL ;
- gérer seuls l’idempotence.

## 41.2 Use cases

Les use cases doivent :

- appliquer les règles ;
- appeler les repositories ;
- exécuter les transactions ;
- produire les événements ;
- retourner un résultat indépendant du HTTP.

## 41.3 Interceptors et filters

Utiliser des composants transverses pour :

- enveloppe ;
- request ID ;
- logs ;
- erreurs ;
- tracing ;
- timing.

Ne pas masquer les particularités HTTP nécessaires, notamment :

- `204` ;
- streaming ;
- fichiers ;
- webhooks ;
- SSE.

---

# 42. Règles d’implémentation pour l’agent IA

L’agent DOIT :

1. inspecter l’architecture existante ;
2. identifier les conventions actuelles ;
3. produire un plan de migration ;
4. créer une API commune réutilisable ;
5. ne pas modifier toutes les routes en une seule opération risquée ;
6. maintenir la compilation ;
7. produire les tests ;
8. mettre à jour OpenAPI ;
9. produire des exemples ;
10. vérifier les breaking changes.

L’agent NE DOIT PAS :

- inventer un format différent par module ;
- retourner les modèles ORM ;
- utiliser `any` comme contrat ;
- accepter des filtres SQL libres ;
- construire un curseur non déterministe ;
- considérer Base64 comme une signature ;
- implémenter l’idempotence avec un simple cache non atomique ;
- implémenter la concurrence seulement côté frontend ;
- utiliser un rate limit seulement en mémoire en production multi-instance ;
- accepter `tenantId` comme preuve ;
- mettre les secrets dans les logs ;
- répondre `200` à toutes les erreurs ;
- laisser des routes non documentées ;
- contourner les tests pour terminer.

## 42.1 Avant chaque phase

L’agent doit fournir :

- fichiers créés ;
- fichiers modifiés ;
- migrations ;
- risques ;
- rollback ;
- tests prévus.

## 42.2 Après chaque phase

L’agent doit exécuter :

- format ;
- lint ;
- compilation ;
- unit tests ;
- integration tests ;
- E2E ;
- validation OpenAPI ;
- analyse de breaking changes.

## 42.3 Livrables

```text
docs/api/api-design-guidelines.md
docs/api/error-catalogue.md
docs/api/versioning-policy.md
docs/api/deprecation-policy.md
docs/api/idempotency-policy.md
docs/api/rate-limit-policy.md
docs/api/openapi.yaml
```

---

# 43. Critères d’acceptation

L’implémentation est acceptée si :

- toutes les réponses JSON utilisent `data/meta/error` ;
- tous les codes d’erreur sont stables ;
- les statuts HTTP sont sémantiques ;
- la pagination cursor fonctionne dans les deux sens ;
- les curseurs sont opaques et déterministes ;
- les filtres et tris sont allowlistés ;
- les mutations critiques supportent l’idempotence ;
- la réutilisation d’une clé avec un body différent est refusée ;
- les requêtes concurrentes ne doublonnent pas les effets ;
- le contrôle de concurrence est présent ;
- les `429` incluent `Retry-After` ;
- le rate limit est distribué ;
- les request IDs et traces sont propagés ;
- le tenant est résolu côté serveur ;
- l’autorisation objet est testée ;
- les DTO rejettent les propriétés interdites ;
- les limites de body sont appliquées ;
- les traitements longs retournent `202` ;
- les jobs ont un endpoint de statut ;
- les versions et dépréciations sont documentées ;
- OpenAPI correspond à l’implémentation ;
- aucun secret n’est loggué ;
- les tests contractuels, E2E et sécurité passent.

---

# 44. Checklist de production

## Contrat

- [ ] Base path `/api/v1`
- [ ] URI cohérentes
- [ ] Méthodes HTTP correctes
- [ ] Codes HTTP corrects
- [ ] Enveloppe uniforme
- [ ] Catalogue d’erreurs

## Collections

- [ ] Cursor pagination
- [ ] Next et previous
- [ ] Tri déterministe
- [ ] Allowlist tri
- [ ] Allowlist filtres
- [ ] Limite maximale
- [ ] Curseur signé

## Mutations

- [ ] Idempotency-Key
- [ ] Hash canonique
- [ ] Unicité atomique
- [ ] Replay correct
- [ ] Conflit body différent
- [ ] Transaction
- [ ] Audit

## Concurrence

- [ ] Version ou ETag
- [ ] If-Match
- [ ] 409/412 cohérent
- [ ] Test simultané
- [ ] Pas de lost update

## Rate limiting

- [ ] Redis partagé
- [ ] Limites global/user/tenant
- [ ] 429
- [ ] Retry-After
- [ ] Stratégie de panne
- [ ] Métriques

## Headers

- [ ] Content-Type
- [ ] Accept
- [ ] Location
- [ ] ETag
- [ ] Cache-Control
- [ ] X-Request-Id
- [ ] traceparent
- [ ] Deprecation/Sunset si nécessaire

## Sécurité

- [ ] Authentification
- [ ] Autorisation fonction
- [ ] Autorisation objet
- [ ] Autorisation propriétés
- [ ] Tenant server-side
- [ ] Validation stricte
- [ ] Mass assignment bloqué
- [ ] Taille body
- [ ] SSRF
- [ ] CORS
- [ ] CSRF si cookies
- [ ] Aucun secret loggué

## Observabilité

- [ ] Logs structurés
- [ ] Traces
- [ ] Métriques
- [ ] p95/p99
- [ ] Route templates
- [ ] Alertes 5xx
- [ ] Alertes 429

## Documentation

- [ ] OpenAPI valide
- [ ] Exemples
- [ ] Erreurs
- [ ] Versioning policy
- [ ] Deprecation policy
- [ ] Idempotency policy
- [ ] Rate-limit policy
- [ ] Migration guides

---

# 45. Références normatives et techniques

La revue de cette architecture doit s’appuyer sur les sources suivantes :

- RFC 9110 — HTTP Semantics
- RFC 9457 — Problem Details for HTTP APIs
- RFC 8288 — Web Linking
- RFC 8594 — Sunset HTTP Header
- RFC 9745 — Deprecation HTTP Response Header
- W3C Trace Context
- OpenAPI Specification
- OWASP API Security Top 10
- IETF Internet-Draft — Idempotency-Key HTTP Header Field
- IETF Internet-Draft — RateLimit Fields for HTTP

> **Note importante :** les Internet-Drafts sont des travaux en cours. Ils ne doivent pas être présentés comme des RFC définitives tant qu’ils ne sont pas publiés comme tels. L’agent doit vérifier le statut normatif actuel avant d’affirmer une conformité.

---

# Instruction finale à l’agent IA

Implémenter cette convention progressivement et sans raccourci.

L’agent doit privilégier :

1. la cohérence du contrat ;
2. la sécurité ;
3. l’isolation tenant ;
4. l’atomicité ;
5. l’observabilité ;
6. la compatibilité ;
7. la qualité des tests.

L’agent ne doit pas produire uniquement des exemples ou une proposition théorique. Il doit produire :

- une implémentation compilable ;
- les composants transverses ;
- les tests ;
- le document OpenAPI ;
- les politiques de versionnement ;
- les politiques d’idempotence ;
- les politiques de rate limiting ;
- un rapport des écarts restants.
