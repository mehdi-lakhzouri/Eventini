# ADR-0008 — Enveloppe de réponse : RFC 9457 Problem Details

| | |
|---|---|
| **Statut** | Accepté |
| **Date** | 2026-07-30 |
| **Contradiction résolue** | **C-3**, **C-4**, **C-5**, **C-22** |
| **Impacte** | filtre d'exception global, intercepteur de réponse, `ApiError` frontend, tous les tests de contrat |

## Contexte

**Trois** enveloppes incompatibles coexistent dans le corpus :

| Source | Forme |
|---|---|
| `EVENTINI_PROJECT_CONTEXT.md` §13.4 | `{ error: {code, message, details}, meta: {requestId, timestamp} }` |
| Document B §36 | `{ data: null, meta: {requestId}, error: {code, message} }` |
| Document C §11.1 | RFC 9457 complet : `{ data, meta: {requestId, timestamp, apiVersion}, error: {type, title, status, code, detail, instance, errors[], retryable} }` |

Et **deux** espaces de noms de codes d'erreur pour les mêmes conditions : `AUTH_PERMISSION_DENIED` (B) contre `PERMISSION_DENIED` (C), `AUTH_TENANT_DENIED` contre `TENANT_ACCESS_DENIED`.

## Décision

**Le Document C l'emporte.** L'enveloppe canonique est RFC 9457, avec les trois clés `data` / `meta` / `error` toujours présentes.

```json
{
  "data": null,
  "meta": {
    "requestId": "req_01JABCDEF",
    "timestamp": "2026-07-30T12:00:00.050Z",
    "apiVersion": "v1"
  },
  "error": {
    "type": "https://errors.eventini.com/tenant-access-denied",
    "title": "Tenant access denied",
    "status": 403,
    "code": "AUTH_TENANT_DENIED",
    "detail": "The requested resource does not belong to the active organization.",
    "instance": "/api/v1/events/evt_01JXYZ",
    "errors": [],
    "retryable": false
  }
}
```

`meta` porte **toujours** `requestId`, `timestamp`, `apiVersion`. C'est ce qui résout C-4.

### Codes d'erreur — un seul espace de noms, préfixé par domaine

Les 11 codes `AUTH_*` du Document B sont **conservés** et deviennent des valeurs de `error.code`. Les codes génériques du Document C sont conservés pour les conditions non liées à l'authentification. La règle de départage est le domaine, pas le document d'origine :

| Condition | Code retenu | Écarté |
|---|---|---|
| Permission insuffisante dans un contexte authentifié | `AUTH_PERMISSION_DENIED` | `PERMISSION_DENIED` |
| Accès cross-tenant | `AUTH_TENANT_DENIED` | `TENANT_ACCESS_DENIED` |
| Authentification absente ou invalide | `AUTHENTICATION_REQUIRED` | — |
| Session expirée / révoquée | `AUTH_SESSION_EXPIRED` / `AUTH_SESSION_REVOKED` | — |
| Rate limit | `RATE_LIMIT_EXCEEDED` | — |
| Conflit d'idempotence | `IDEMPOTENCY_CONFLICT` | — |

`PRECONDITION_FAILED`, présent uniquement dans un exemple du Document C §39.4 et absent de son propre catalogue (C-22), est ajouté au catalogue officiel. Le catalogue complet vit dans [`API_CONVENTIONS.md`](../api/API_CONVENTIONS.md) et fait autorité.

### Espaces de noms distincts

Un `eventCode` de log (`RATE_LIMIT_EXCEEDED`, `TENANT_ACCESS_DENIED` du Document D) et un `error.code` HTTP peuvent porter le même texte. Ce sont **deux espaces de noms distincts**, ils ne sont pas synchronisés et ne doivent pas l'être. La correspondance, quand elle existe, est documentée dans le catalogue.

### Actions sans représentation

Le Document C §10.4 laissait le choix ouvert entre `204` sans corps et `200` avec `data: null`. **Retenu : `204 No Content`**, sauf si l'appelant a besoin de `meta.requestId` — auquel cas `200` avec `data: null`. La règle par défaut est `204`. Résout une partie de C-21.

## Conséquences

**Positives** — alignement sur un standard IETF ; `errors[]` donne des erreurs par champ exploitables directement par React Hook Form ; `retryable` évite au client de deviner ; `instance` et `requestId` rendent chaque erreur traçable jusqu'à une ligne de log.

**Négatives** — enveloppe plus verbeuse que `{code, message}` ; `type` impose de servir une documentation d'erreurs sous `https://errors.eventini.com/` — au MVP ce sont des URI stables et non résolues, ce qui est explicitement autorisé par la RFC ; `ApiError` côté frontend doit être réécrit (il ne lit aujourd'hui même pas le corps de la réponse).

## Alternatives rejetées

- **Forme simple de `PROJECT_CONTEXT` §13.4** — le document canonique l'emporte par sa propre règle de précédence §1. Rejeté quand même : il abandonne `errors[]`, `retryable` et l'alignement RFC, et le Document C est bien plus détaillé sur ce point précis. Le §1 fait aussi primer « une décision récente et explicitement validée », ce qu'est cet ADR.
- **RFC 9457 sans `type` ni `instance`** — évite d'héberger une documentation d'erreurs. Coût quasi nul de les garder, on les garde.

## Vérification

Test de contrat : toute réponse d'erreur de l'API valide un schéma JSON unique ; toute réponse de succès porte `meta.requestId`, `meta.timestamp`, `meta.apiVersion`.
