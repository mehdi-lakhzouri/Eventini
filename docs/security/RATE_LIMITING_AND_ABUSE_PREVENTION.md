# Eventini — Rate limiting et prévention des abus

> **Statut :** Spécification normative · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Décision :** [ADR-0013](../adr/0013-rate-limiting-and-lockout-baseline.md) · **Implémentation :** [`REDIS_KEYS_AND_LUA_SCRIPTS.md`](../infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md)
> **OWASP :** API4 Unrestricted Resource Consumption · ASVS V2.2

> ⚠️ **Il n'existe aujourd'hui aucun rate limiting dans le dépôt.** `@nestjs/throttler ^6.5.0` est installé et **jamais importé**. Aucun script Lua, aucun `eval(`, aucun compteur. Le seul artefact concret du corpus entier est un nom de politique dans un exemple de log du Document D : `LOGIN_BY_IP_AND_EMAIL`.

---

## 1. Contexte d'usage

Une contrainte métier commande une grande partie des choix de ce document : **les administrateurs et opérateurs d'un événement se connectent depuis le lieu de l'événement**, donc massivement derrière un même NAT. Une limite par IP calibrée pour un usage domestique bloquerait une équipe entière au pire moment.

Symétriquement, un opérateur de scan produit des rafales légitimes de requêtes — jusqu'à plusieurs centaines par minute lors d'une synchronisation offline.

Les limites ci-dessous sont donc calibrées pour ce contexte, pas pour un SaaS générique.

---

## 2. Hiérarchie

Quatre couches. **La plus restrictive gagne.** Une requête traverse toutes les couches applicables ; le premier dépassement produit un `429`.

```
1  Global par IP              protection de l'infrastructure
2  Par organisation (tenant)  équité entre clients
3  Par utilisateur / session  protection du compte
4  Par endpoint               protection de l'opération
```

Une requête authentifiée de check-in traverse : global IP → organisation → appareil → endpoint de check-in.

---

## 3. Limites globales

| Dimension | Limite | Fenêtre | Motif |
|---|---|---|---|
| IP, toutes routes | 300 req | 1 min | tolère un NAT d'équipe ; bloque le scraping |
| Utilisateur authentifié | 1 000 req | 1 min | un tableau de bord actif reste très en dessous |
| Organisation | 5 000 req | 1 min | équité entre tenants, empêche un client de saturer la plateforme |
| IP non authentifiée, routes publiques | 60 req | 1 min | plus strict : aucune raison légitime d'un fort volume anonyme |

---

## 4. Limites par endpoint sensible

| Endpoint | Limite | Clé | Motif |
|---|---|---|---|
| `POST /auth/sessions` | **5 / 15 min** | `ip+email` | bruteforce ciblé |
| `POST /auth/sessions` | **20 / 15 min** | `ip` | bruteforce distribué sur plusieurs comptes |
| `POST /auth/mfa/challenges/{id}/verification` | **5 / 5 min** | `challengeId` | 6 chiffres = 10⁶ possibilités ; 5 essais par challenge de 5 min rend le forçage irréaliste |
| `POST /auth/sessions/current/rotation` | **30 / h** | `sessionId` | une session légitime tourne toutes les 10 min |
| `POST /auth/password-reset-requests` | **3 / h** | `email` | empêche le harcèlement par email |
| `POST /auth/password-reset-requests` | **10 / h** | `ip` | |
| `POST /auth/password-resets` | **5 / h** | `ip` | forçage de token de reset |
| `POST /auth/invitation-acceptances` | **10 / h** | `ip` | forçage de token d'invitation |
| `POST /auth/reauthentications` | **5 / 15 min** | `sessionId` | |
| `POST /events/{id}/check-ins` | **600 / min** | `deviceId` | ~20 scans/min en usage réel ; la marge absorbe la synchronisation offline |
| `POST /events/{id}/attendance-sync` | **10 / min** | `deviceId` | lots volumineux, peu fréquents |
| `POST /participants/imports` | **5 / h** | `organizationId` | opération lourde |
| `POST /reports/exports` | **20 / h** | `organizationId` | |
| `GET /events/{id}/live` (SSE) | **10 connexions** | `userId` | limite de connexions, pas de débit |

---

## 5. Verrouillage de compte

### 5.1 L'échelle

Clé **`ip+email`** :

| Échecs consécutifs | Verrou |
|---|---|
| 5 | 15 min |
| 10 | 1 h |
| 15 | 24 h |

Une authentification réussie remet le compteur à zéro.

### 5.2 Pourquoi `ip+email` et pas `email`

C'est la décision centrale de ce document.

Un verrouillage sur l'email **seul** permet à un attaquant de bloquer n'importe quel utilisateur dont il connaît l'adresse, en échouant délibérément cinq fois. Le mécanisme de sécurité devient l'arme : un déni de service contre la victime, gratuit, à distance, et impossible à distinguer d'une vraie attaque.

La clé `ip+email` supprime ce vecteur. Un attaquant bloque **sa propre** paire, pas le compte.

Un compteur par email existe malgré tout, mais il ne verrouille **jamais** :

| Compteur | Effet |
|---|---|
| `ip+email` | verrouillage progressif |
| `email` seul, 20 échecs / h toutes IP | security event `ACCOUNT_LOCKED` (sévérité `HIGH`) + alerte — **aucun blocage** |
| `ip` seul, 50 échecs / h tous comptes | `429` prolongé sur l'IP — signature de credential stuffing |

Le compteur par email sert la **détection**, pas le blocage. C'est le bon compromis : on voit l'attaque, la victime garde son accès.

### 5.3 Ce que le client voit

Rien.

Un compte verrouillé reçoit `401 AUTH_INVALID_CREDENTIALS`, exactement comme un mot de passe faux ou un compte inexistant. Le code `AUTH_ACCOUNT_LOCKED` existe dans le catalogue mais **n'est jamais renvoyé** : il n'apparaît que dans `security_events`.

Annoncer le verrouillage confirmerait l'existence du compte et signalerait à l'attaquant que son déni de service a fonctionné.

### 5.4 Déverrouillage

| Voie | Condition |
|---|---|
| Expiration | automatique |
| Reset de mot de passe réussi | remet le compteur à zéro |
| Intervention support | `SUPER_ADMIN` avec réauthentification, audité |

---

## 6. Réponse `429`

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 47
RateLimit-Limit: 5
RateLimit-Remaining: 0
RateLimit-Reset: 47
Content-Type: application/problem+json
```

```json
{
  "data": null,
  "meta": { "requestId": "req_01JABC", "timestamp": "…", "apiVersion": "v1" },
  "error": {
    "type": "https://errors.eventini.com/rate-limit-exceeded",
    "title": "Rate limit exceeded",
    "status": 429,
    "code": "RATE_LIMIT_EXCEEDED",
    "detail": "Too many requests. Retry after 47 seconds.",
    "instance": "/api/v1/auth/sessions",
    "errors": [],
    "retryable": true
  }
}
```

`Retry-After` porte un **jitter de ±10 %** : sans lui, tous les clients bloqués réessaient à la même seconde et reconstituent le pic.

La réponse ne révèle **jamais** quelle dimension a été dépassée. Dire « limite par email atteinte » confirmerait l'existence du compte.

---

## 7. Implémentation

### 7.1 Algorithme

**Fenêtre glissante** par sorted set Redis, en Lua ([ADR-0011](../adr/0011-redis-lua-atomic-operations.md)).

Fenêtre glissante plutôt que fenêtre fixe : une fenêtre fixe autorise le double de la limite à cheval sur deux fenêtres (5 requêtes à 14 min 59 s, 5 autres à 15 min 01 s). Sur un endpoint de login, c'est une différence qui compte.

```lua
-- KEYS[1] clé de fenêtre
-- ARGV[1] limite   ARGV[2] fenêtre ms   ARGV[3] maintenant ms   ARGV[4] id unique
redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, ARGV[3] - ARGV[2])
local used = redis.call('ZCARD', KEYS[1])
if used >= tonumber(ARGV[1]) then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  return { 0, 0, math.ceil((oldest[2] + ARGV[2] - ARGV[3]) / 1000) }
end
redis.call('ZADD', KEYS[1], ARGV[3], ARGV[4])
redis.call('PEXPIRE', KEYS[1], ARGV[2])
return { 1, tonumber(ARGV[1]) - used - 1, 0 }
```

Un aller-retour. Aucune course. Aucun compteur orphelin sans TTL.

### 7.2 `@nestjs/throttler` n'est pas utilisé

Installé, jamais importé, et il le restera. Il ne couvre ni le multi-dimension (`ip+email` **et** `ip` **et** `organizationId` sur la même requête), ni le verrouillage progressif, ni la fenêtre glissante distribuée. L'adapter coûterait plus cher que les quatre scripts Lua.

À retirer de `package.json` au sprint 05.

### 7.3 Clés Redis

```
rl:{policy}:{dimension}:{value}       fenêtre glissante
lockout:{ip}:{emailHash}              état de verrouillage
lockout:counter:{emailHash}           compteur de détection, sans blocage
```

L'email est **haché** (SHA-256 tronqué à 128 bits) avant d'entrer dans une clé Redis : les clés apparaissent dans `MONITOR`, `SLOWLOG` et les dumps de diagnostic. Un email en clair y serait une fuite de PII.

Catalogue complet : [`REDIS_KEYS_AND_LUA_SCRIPTS.md`](../infrastructure/REDIS_KEYS_AND_LUA_SCRIPTS.md).

### 7.4 Repli si Redis est indisponible

Le Document C §21.9 laissait le choix ouvert. Décision :

| Type de route | Comportement |
|---|---|
| Authentification, MFA, reset, invitation | **fail closed** — `503 DEPENDENCY_UNAVAILABLE` |
| Toutes les autres | **fail open** + log `error` + métrique `redis_fallback_total` |

Un rate limiter en panne ne doit pas rendre l'application inutilisable, mais il ne doit **jamais** ouvrir la porte au bruteforce. Un événement en cours continue de fonctionner ; les connexions sont suspendues jusqu'au retour de Redis.

### 7.5 Ordre d'exécution

Le rate limiting s'exécute **avant** toute opération coûteuse — en particulier avant la vérification Argon2id, qui consomme 19 MiB et ~60 ms. Sinon l'endpoint de login devient lui-même le vecteur de déni de service.

```
requête → requestId → CORS/Origin → rate limit → CSRF
        → validation du corps → auth → Argon2id → autorisation → traitement
```

### 7.6 Proxy de confiance

L'IP client provient de `X-Forwarded-For`, **uniquement** si la requête vient d'un proxy déclaré de confiance. `trust proxy` est configuré explicitement avec le nombre de sauts, jamais avec `true`.

Sans cela, `X-Forwarded-For` est un en-tête fourni par le client : n'importe qui contourne toute limite par IP en le forgeant. C'est l'erreur la plus courante dans les implémentations de rate limiting.

---

## 8. Autres protections contre l'abus

### 8.1 Limites de charge utile

| Type | Limite |
|---|---|
| Corps JSON | 100 Ko |
| Corps JSON, routes d'import | 1 Mo |
| Import CSV/Excel | 10 Mo |
| Lot de synchronisation attendance | 500 opérations |
| Profondeur d'imbrication JSON | 10 |
| Éléments par tableau | 1 000 |
| Longueur d'URL | 2 048 |
| Taille d'un en-tête | 8 Ko |

Ces limites sont vérifiées **avant** le parsing, pas après : parser 100 Mo pour découvrir qu'ils sont trop gros a déjà consommé la mémoire.

### 8.2 Limites de requête

| Paramètre | Défaut | Maximum |
|---|---|---|
| `limit` (pagination) | 20 | **100** |
| `search` | — | 100 caractères, minimum 2 |
| `include` | — | 5 relations |
| `fields` | — | 50 champs |

Le Document C §13.3 exigeait un défaut et un maximum sans jamais donner de valeur. Les voici.

### 8.3 Traitements coûteux

Import, export et génération de rapport sont **asynchrones** : `202 Accepted` + suivi de job. Une requête HTTP ne tient jamais un traitement long.

| Contrainte | Valeur |
|---|---|
| Jobs concurrents par organisation | 3 |
| Lignes par import | 50 000 |
| Timeout de job | 15 min |
| Tentatives | 5, backoff exponentiel avec jitter |

### 8.4 Anti-énumération

| Surface | Protection |
|---|---|
| Login | réponse et durée identiques quel que soit le cas |
| Reset de mot de passe | `202` systématique, même si l'email est inconnu |
| Invitation | aucune indication d'existence |
| Ressource d'un autre tenant | `403`, ou `404` si l'existence même est sensible |
| Identifiants | UUID v7, jamais séquentiels |

### 8.5 Anti-rejeu QR

| Contrôle | Valeur |
|---|---|
| Nonce à usage unique | 90 s |
| Vérification de signature | avant toute lecture de base |
| Index unique de check-in | `ux_attendance_checkin_unique` |
| Scans refusés par appareil | > 20 / min ⇒ `security event` + alerte |

Trois défenses en profondeur : le nonce bloque le rejeu immédiat, l'index bloque le doublon logique, la détection de rafale signale un appareil compromis.

---

## 9. Observabilité

### 9.1 Métriques

| Métrique | Labels |
|---|---|
| `rate_limit_exceeded_total` | `policy`, `route` |
| `login_failures_total` | `reason` |
| `account_lockouts_total` | `tier` |
| `security_events_total` | `category`, `eventCode` |
| `redis_fallback_total` | `operation` |
| `refresh_token_reuse_total` | — |

**Jamais** de label `userId`, `email`, `ip`, `sessionId` ni `requestId` : cardinalité non bornée, ce qui fait exploser le stockage de métriques.

### 9.2 Alertes

| Alerte | Seuil |
|---|---|
| `REFRESH_TOKEN_REUSE_DETECTED` | **immédiate**, toute occurrence |
| `ORGANIZATION_KILL_SWITCH_EXECUTED` | immédiate |
| Aucun `SUPER_ADMIN` actif | immédiate |
| `LOGIN_FAILED` | > 100 / 5 min globalement |
| `LOGIN_FAILED` sur un même email | > 20 / h — signature d'attaque ciblée |
| `CSRF_VALIDATION_FAILED` | > 20 / 5 min |
| `TENANT_ACCESS_DENIED` | > 10 / 5 min — quelqu'un sonde les frontières de tenant |
| `RATE_LIMIT_EXCEEDED` | > 500 / 5 min |
| `redis_fallback_total` | toute occurrence en production |
| `UNSCOPED_QUERY_EXECUTED` | toute occurrence — bug d'isolation potentiel |

`TENANT_ACCESS_DENIED` en hausse est le signal le plus important de cette liste : il signifie que quelqu'un teste activement l'isolation multi-tenant.

---

## 10. Tests

| # | Test | Attendu |
|---|---|---|
| 1 | 6 logins échoués, même `ip+email` | `429` au 6ᵉ |
| 2 | 5 échecs, puis attendre 15 min | déverrouillé |
| 3 | Attaquant échoue 10× sur l'email d'une victime | **la victime se connecte normalement** |
| 4 | Requête à la limite exacte | acceptée |
| 5 | Limite + 1 | `429` avec `Retry-After` |
| 6 | Fenêtre glissante à cheval | pas de double autorisation |
| 7 | 100 requêtes concurrentes, limite 10 | exactement 10 acceptées |
| 8 | Redis arrêté, route de login | `503`, jamais `200` |
| 9 | Redis arrêté, route de lecture | `200` + log `error` |
| 10 | `X-Forwarded-For` forgé sans proxy de confiance | ignoré, IP réelle utilisée |
| 11 | Corps JSON de 200 Ko | `413` avant parsing |
| 12 | `limit=5000` | ramené à 100, ou `400` |
| 13 | Verrouillage actif | réponse `AUTH_INVALID_CREDENTIALS`, jamais `AUTH_ACCOUNT_LOCKED` |
| 14 | Login inexistant vs mot de passe faux | durées statistiquement indiscernables |
