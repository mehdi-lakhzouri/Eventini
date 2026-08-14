# Sprint 02 — Bootstrap sécurisé

> [← Sprint 01](../sprint-01/README.md) · [Index des sprints](../SPRINT_PLAN.md) · [Sprint 03 →](../sprint-03/README.md)

| | |
|---|---|
| **Tickets** | EVT-008 → EVT-013 |
| **Prérequis** | Sprint 01 |
| **Migrations** | aucune |
| **Jalon** | — |

---

## Objectif

Une application qui **se configure**, **refuse de démarrer mal configurée**, **journalise** et **expose sa santé**.

Invariant **O-2** : la configuration et l'observabilité précèdent l'authentification. Écrire de l'authentification sans logs structurés ni validation d'environnement rend chaque bug invisible — et un bug d'authentification invisible est une faille.

## Critère de sortie

- `GET /api/v1/health/ready` retourne `200` ;
- un démarrage avec une variable manquante échoue en `fatal` **en la nommant** ;
- une requête HTTP produit une ligne Pino portant un `requestId` ;
- `/metrics` répond.

---

## Tickets

| # | Titre |
|---|---|
| [EVT-008](#evt-008) | ConfigModule et validation d'environnement bloquante |
| [EVT-009](#evt-009) | Bootstrap `main.ts` |
| [EVT-010](#evt-010) | Enveloppe de réponse et filtre d'exception |
| [EVT-011](#evt-011) | Logging Pino |
| [EVT-012](#evt-012) | Health checks et métriques |
| [EVT-013](#evt-013) | Dockerfiles |

---

## EVT-008 — ConfigModule et validation d'environnement bloquante
<a id="evt-008"></a>

> ✅ **Fait le 30 juillet 2026.** Les 14 règles croisées sont implémentées et **vérifiées de bout en bout** : l'application démarre avec un `.env` valide, refuse de démarrer sans, et refuse de démarrer avec `.env.example` copié tel quel.

```
Branche  feat/EVT-008-config-validation
Commit   feat(config): add typed configuration with blocking env validation
```

### Structure livrée

```
backend/src/config/
├── env.schema.ts               ~130 variables, formes et défauts (zod)
├── validate-environment.ts     orchestration : schéma puis règles
├── describe-error.ts           extraction de message fiable (voir plus bas)
├── parsers/                    unités pures et testables
│   ├── duration.parser.ts      "14d" → 1209600000
│   ├── size.parser.ts          "10mb" → 10485760
│   ├── csv.parser.ts
│   └── secret.parser.ts        base64 + détection de placeholder
├── rules/                      une règle = un fichier
│   ├── production-hardening.rule.ts   règles 2-5
│   ├── secret-hygiene.rule.ts         règles 7-9
│   ├── key-pair.rule.ts               règle 10
│   └── coherence.rule.ts              règles 6, 11-14
└── {application,authentication,cookies,csrf,database,rate-limit,redis}.config.ts
```

**Deux passes, jamais une seule** — le schéma répond « chaque valeur est-elle bien formée ? », les règles répondent « ces valeurs sont-elles cohérentes entre elles ? ». Dans chaque passe, **toutes** les erreurs sont collectées.

### Vérification réelle, pas déclarative

| Scénario | Résultat observé |
|---|---|
| `.env` généré, démarrage | **BOOTED OK** |
| Aucun `.env` | refus, **25 variables manquantes nommées d'un coup**, code de sortie non nul |
| `.env.example` copié tel quel | refus citant **11 placeholders par nom** — jamais un message trompeur sur l'entropie |
| Réutilisation d'un secret (règle 8) | `CSRF_SECRET is identical to COOKIE_SECRET … reuse defeats the key separation` |
| Paire de clés dépareillée (règle 10) | `does not match … locking out every user` |
| `production` + cookie non sécurisé + origine http | les 4 règles de durcissement remontent **simultanément** |

### Deux défauts trouvés en écrivant les tests

**`instanceof Error` n'est pas fiable.** Les erreurs de `node:crypto` traversent une frontière de realm sous Jest et échouent le test `instanceof` tout en étant de parfaites `Error`. Le message affiché devenait « unknown error » — dans un message dont le seul rôle est d'expliquer ce qui ne va pas. Remplacé par `describeError()`, qui teste la présence d'un `message` plutôt que le prototype. Le même motif existait à **5 endroits** ; tous corrigés.

**Le message de la règle 10 nommait un libellé humain, pas la variable.** Un opérateur lisait « Access token signing key pair could not be loaded » sans savoir quelle entrée corriger. Le message nomme désormais `ACCESS_TOKEN_PRIVATE_KEY / ACCESS_TOKEN_PUBLIC_KEY` et pointe vers le générateur.

### `scripts/generate-dev-env.mjs`

Le refus de démarrer est correct mais rendrait la première installation pénible : douze secrets à générer à la main. Le script écrit un `.env` complet avec **11 secrets indépendants** et **2 paires Ed25519 réelles**. Le fail-closed reste un principe sans devenir une brimade.

Il refuse d'écraser un `.env` existant sans `--force`, et écrit en `0600`.

**Scope** — `configuration.ts` avec namespaces typés, `validation.schema.ts`, les 14 règles croisées de [`ENVIRONMENT_VARIABLES.md` §17](../../operations/ENVIRONMENT_VARIABLES.md), `backend/.env.example`, `web/.env.example`.

**État actuel** — `backend/src/config/` contient 7 fichiers d'une ligne, chacun `export const xConfig = {};`. `ConfigModule` n'est importé nulle part. Il n'existe **aucun** `.env` sous `backend/` ni `web/`.

### Décision : ajouter `zod` au backend

`class-validator` est installé, `zod` ne l'est pas. Ajouter `zod` est justifié : il valide **et** type en une seule passe, en dehors du cycle de vie de l'injection de dépendances — donc utilisable **avant** que Nest ne démarre. `class-validator` exige des classes instanciées, ce qui arrive trop tard pour bloquer un démarrage.

### Règles croisées — les plus importantes

Ce ne sont pas de simples vérifications de présence :

| # | Règle | Ce qu'elle attrape |
|---|---|---|
| 8 | Aucun secret n'est égal à un autre | un copier-coller de secret, qui annulerait leur séparation |
| 9 | Aucun secret ne vaut une valeur d'exemple connue | un `.env.example` laissé en place au déploiement |
| 10 | La clé publique correspond à la clé privée | une paire de clés dépareillée |
| 2-5 | `production` ⇒ `COOKIE_SECURE`, redaction, pas de seed démo, origines en `https://` | une configuration de développement déployée en production |
| 14 | `ARGON2_MEMORY_COST ≥ 19456` | un réglage sous le seuil OWASP |

**Tests obligatoires**

| Cas | Attendu |
|---|---|
| Variable requise manquante | `fatal` nommant **toutes** les fautives, pas seulement la première (`abortEarly: false`) |
| Secret de moins de 32 octets | `fatal` |
| Deux secrets identiques | `fatal` |
| `ACCESS_TOKEN_PUBLIC_KEY` ne correspondant pas à la privée | `fatal` |
| `NODE_ENV=production` + `COOKIE_SECURE=false` | `fatal` |
| `SESSION_IDLE_TTL > SESSION_ABSOLUTE_TTL` | `fatal` |

**Pourquoi bloquant et non un avertissement** — une valeur par défaut silencieuse en production est la source classique d'OWASP A05. Un service qui démarre à moitié configuré est bien pire qu'un service qui refuse de démarrer : l'orchestrateur redémarre, échoue à nouveau, et le déploiement est marqué en échec — ce qui est le comportement voulu.

---

## EVT-009 — Bootstrap `main.ts`
<a id="evt-009"></a>

> ✅ **Fait le 31 juillet 2026.** `main.ts` implémente la séquence complète de [`BACKEND_ARCHITECTURE.md` §4](../../architecture/BACKEND_ARCHITECTURE.md), **vérifiée sur une instance réellement démarrée** (`curl` et une suite e2e), pas seulement relue.

```
Branche  feat/EVT-009-secure-bootstrap
Commit   feat(app): wire security middleware and global pipeline
```

### Structure livrée

```
backend/src/bootstrap/
├── helmet.options.ts               CSP, HSTS, referrer, frame-options, COOP/CORP
├── permissions-policy.middleware.ts  Helmet 8.3 n'a plus cette option — middleware dédié
├── cors.options.ts                 origines exactes, jamais un pattern
├── validation-pipe.factory.ts      whitelist + forbidNonWhitelisted + transform
├── swagger.setup.ts                gaté par SWAGGER_ENABLED
└── index.ts

backend/test/bootstrap/security-bootstrap.e2e-spec.ts   les 6 tests négatifs ci-dessous
```

### Bug critique trouvé en testant : la validation d'environnement se corrompait elle-même

`getValidatedEnv()` (EVT-008) relit `process.env` une seconde fois dans chaque factory `registerAs`, indépendamment du `validate` déjà passé à `ConfigModule.forRoot()`. Or `assignVariablesToProcess()` — une méthode interne de `@nestjs/config`, jamais documentée — **réécrit sa sortie validée dans `process.env`** pour toute clé absente de `process.env` au moment où `validate` s'exécute. Concrètement : une durée `"10m"` devenait la chaîne `"600000"` (les millisecondes, pas le format attendu), et un tableau (`CORS_ALLOWED_ORIGINS`) disparaissait purement et simplement — les tableaux ne survivent pas à `process.env`.

La seconde passe de validation, dans les factories, recevait donc ces valeurs déjà corrompues et échouait — avec 24 erreurs d'un coup. Et l'échec restait **invisible** : `NestFactory.create()` enveloppe l'instanciation des providers dans sa propre `ExceptionsZone`, qui intercepte toute erreur synchrone et appelle `process.exit(1)` **directement**, sans jamais rejeter la promesse que `bootstrap().catch(...)` attend. Diagnostiqué en isolant chaque variable une par une (avec/sans `validate`, avec/sans `load`, règle crypto seule, etc.) jusqu'à reproduire l'échec avec le logger Nest réactivé, qui a fini par imprimer le message que `{ logger: false }` masquait pendant l'investigation.

**Correctif** — `app.module.ts` charge désormais `.env` dans `process.env` lui-même, via `dotenv.config()`, **avant** que le décorateur `@Module` n'évalue `ConfigModule.forRoot(...)`. Chaque clé étant déjà présente, `assignVariablesToProcess()` devient un no-op et la seconde passe voit les mêmes chaînes brutes que la première. Le correctif vit dans `app.module.ts`, pas dans `main.ts`, pour protéger tout consommateur d'`AppModule` — y compris un futur test e2e qui le démarrerait directement.

### Les cinq points non négociables

| Point | Pourquoi |
|---|---|
| `trust proxy` avec un **nombre de sauts explicite** | `true` laisse n'importe qui forger `X-Forwarded-For` et **contourner tout rate limiting par IP**. C'est l'erreur la plus courante des implémentations de rate limiting |
| `forbidNonWhitelisted: true` | rejette `{"status":"ACTIVE"}` glissé dans un corps — la défense anti mass-assignment (OWASP API3) |
| `enableImplicitConversion: false` | la conversion implicite transforme `"0"` en `false` et crée des failles de validation subtiles |
| `enableShutdownHooks()` | sans lui, un arrêt coupe les transactions en cours et laisse des jobs orphelins |
| `bufferLogs: true` | sinon les logs de démarrage échappent à Pino **et à la redaction** |

### Deux défauts trouvés en écrivant `helmet.options.ts`

Vérifiés contre le code source réel de Helmet 8.3 (`node_modules/helmet`), pas supposés :

- **`permissionsPolicy` n'existe pas** dans `HelmetOptions` — l'option a été retirée du cœur de Helmet il y a plusieurs années. D'où le middleware dédié `permissions-policy.middleware.ts`.
- **`xPoweredBy: false` a la sémantique inverse de l'intuition.** `true` (ou l'absence de la clé) est ce qui *retire* l'en-tête ; `false` le laisse en place. Confirmé en lisant `index.cjs`, pas en devinant.

### Vérification réelle, pas déclarative

Instance démarrée avec `npx ts-node -T src/main.ts`, sondée avec `curl`, puis reproduite dans `test/bootstrap/security-bootstrap.e2e-spec.ts` (6 tests, tous verts) :

| Scénario | Résultat observé |
|---|---|
| Les 7 en-têtes de sécurité | tous présents, `X-Powered-By` **absent** |
| Origine autorisée (`http://localhost:3000`) | `Access-Control-Allow-Origin` renvoyé |
| Origine non autorisée (`http://evil.example.com`) | **aucun** en-tête `Access-Control-Allow-Origin` — corrige l'attente initiale d'un `403` : le paquet `cors` ne bloque jamais côté serveur, il omet l'en-tête et laisse le navigateur appliquer le blocage, ce qui est le comportement CORS standard |
| `{"name":"ok","role":"ADMIN"}` sur un DTO qui ne déclare que `name` | `400`, rejeté |
| `{"name":"ok"}` | `201`, accepté tel quel |
| `X-Forwarded-For: 1.1.1.1, 2.2.2.2, 9.9.9.9` avec `TRUSTED_PROXY_HOPS=1` | `req.ip` ≠ `1.1.1.1` — le saut forgé au-delà de la confiance est ignoré |

**Limite assumée** — pas d'endpoint DTO réel n'existe encore dans `IdentityModule` (modules encore vides) ; les tests de whitelist/`req.ip` utilisent un contrôleur `ProbeController` jetable, déclaré uniquement dans le spec, monté à côté d'`AppModule`. Il exerce le pipeline global réel (mêmes fonctions `bootstrap/*`), pas une simulation.

---

## EVT-010 — Enveloppe de réponse et filtre d'exception
<a id="evt-010"></a>

> ✅ **Fait le 31 juillet 2026.** L'enveloppe RFC 9457, le catalogue de 37 codes, `X-Request-Id` et le pipeline de validation sont **vérifiés sur une instance réellement démarrée**, pas seulement relus.

```
Branche  feat/EVT-010-response-envelope
Commit   feat(api): add RFC 9457 response envelope and exception filter
```

**Référence** — [`API_CONVENTIONS.md` §3-4](../../api/API_CONVENTIONS.md), [ADR-0008](../../adr/0008-response-envelope-rfc9457.md).

### Structure livrée

```
backend/src/common/api/
├── error-codes.ts                  37 codes : général (12), auth (12), métier (13)
├── problem-details.types.ts        ApiEnvelope, ProblemDetails, FieldError
├── app-exception.ts                AppException — ce que le code applicatif lève
├── build-problem-details.ts        catalogue + surcharges → ProblemDetails
├── build-response-meta.ts          requestId → { requestId, timestamp, apiVersion }
├── map-unknown-exception.ts        HttpException Nest / erreur inconnue → catalogue
├── map-validation-error-code.ts    contrainte class-validator → REQUIRED/OUT_OF_RANGE/…
├── flatten-validation-errors.ts    ValidationError[] imbriqué → FieldError[] plat
├── response-envelope.interceptor.ts
└── http-exception.filter.ts        catch() unique, un seul log par exception

backend/src/common/middleware/request-id.middleware.ts   X-Request-Id, avant toute route
backend/src/common/types/request-with-id.ts               req.id, posé par le middleware ci-dessus

backend/test/bootstrap/response-envelope.e2e-spec.ts       les 6 tests ci-dessous
```

**Catalogue** — les 12 codes généraux et 13 métier d'`API_CONVENTIONS.md` §4, plus les 12 codes `AUTH_*` d'`AUTHENTICATION_AUTHORIZATION.md` §7. `AUTH_ACCOUNT_LOCKED` en est **délibérément absent** : ce code ne doit jamais atteindre un client (§7 : l'annoncer confirme l'existence du compte à qui l'a verrouillé) — un compte verrouillé reçoit `AUTH_INVALID_CREDENTIALS`, comme tout échec de login.

**Règle du log unique** — `HttpExceptionFilter` journalise **une fois**, au niveau `warn` pour un 4xx et `error` (avec la pile, côté serveur seulement) pour un 5xx. Aucun controller ne rejournalise.

**`exceptionFactory` sur le `ValidationPipe`** — sans lui, une validation échouée produit le `BadRequestException` par défaut de Nest (`{statusCode, message: string[], error}`), pas l'enveloppe RFC 9457. Le pipe lève désormais une `AppException('VALIDATION_ERROR', {errors})`, avec les erreurs de `class-validator` aplaties en `FieldError[]` (chemin en pointillés pour les DTO imbriqués) et chaque contrainte classée dans `REQUIRED` / `OUT_OF_RANGE` / `INVALID_FORMAT` / `UNEXPECTED_FIELD` / `INVALID`.

### Un défaut trouvé en testant sur une instance réelle

**`consumer.apply(RequestIdMiddleware).forRoutes('*')` émettait un avertissement de dépréciation** au démarrage (`LegacyRouteConverter`) : la version de `path-to-regexp` utilisée par `@nestjs/core` a retiré le support du caractère générique nu `*` au profit d'un paramètre nommé. Corrigé en `forRoutes('*path')`, la syntaxe que Nest recommandait lui-même dans le message d'avertissement.

### Vérification réelle, pas déclarative

Instance démarrée avec `npx ts-node -T src/main.ts`, sondée avec `curl`, puis reproduite dans `test/bootstrap/response-envelope.e2e-spec.ts` (6 tests, tous verts) :

| Scénario | Résultat observé |
|---|---|
| Route inconnue (`GET /api/v1/nonexistent`) | `404`, `Content-Type: application/problem+json`, enveloppe complète : `{"data":null,"meta":{...},"error":{"type":"…/resource-not-found","code":"RESOURCE_NOT_FOUND",…}}` |
| Réponse `204` | corps **vide** — l'intercepteur n'enveloppe pas un statut qui interdit un corps |
| Erreur inconnue levée (`Error("relation \"users\" does not exist")`) | `500`, `error.detail` = `"An unexpected error occurred."` — le message original, avec le nom de table, n'apparaît **nulle part** dans la réponse |
| `{"name":"ok","role":"ADMIN"}` sur un DTO qui ne déclare que `name` | `400`, `VALIDATION_ERROR`, `errors: [{"field":"role","code":"UNEXPECTED_FIELD",…}]` |
| `X-Request-Id: my-own-trace-id-999` fourni par le client | conservé tel quel, dans l'en-tête **et** dans `meta.requestId` |
| Aucun `X-Request-Id` fourni | un `req_<uuid>` généré, renvoyé dans l'en-tête et `meta.requestId` |

**Limite assumée** — même limite qu'EVT-009 : `IdentityModule` n'expose encore aucun DTO réel, donc le test de mass-assignment et de `req.id` utilise un `ProbeController` jetable déclaré dans le spec, monté à côté d'`AppModule`, exerçant le pipeline global réel.

---

## EVT-011 — Logging Pino
<a id="evt-011"></a>

> ✅ **Fait le 31 juillet 2026.** Pino est le logger unique, la redaction est **vérifiée sur une instance réellement démarrée** avec une valeur canari cherchée dans stdout — méthode qui a trouvé une fuite qu'aucun test existant ne voyait.

```
Branche  feat/EVT-011-pino-logging
Commit   feat(logging): implement structured Pino logging with redaction
```

**Référence** — [`PINO_LOGGING_SPECIFICATION.md`](../../observability/PINO_LOGGING_SPECIFICATION.md) (Document D) fait autorité sur le schéma de champs, les niveaux, les catégories et la rétention.

### Structure livrée

```
backend/src/infrastructure/logging/
├── logging.constants.ts          routes ignorées, borne de profondeur, placeholder
├── log-categories.ts             les 12 catégories §8
├── log-event-codes.ts            catalogue stable §10, chaque code lié à sa catégorie
├── logging.types.ts              champs corrélation / tenant / résultat §9
├── log-redaction.config.ts       chemins Pino + scrubber récursif (voir C-24)
├── log-serializers.ts            req / res / err (voir C-25)
├── logging.config.ts             options Pino depuis l'env §14-17
├── http-logging.config.ts        options pino-http §19
├── request-context.service.ts    assign() du contexte tenant résolu §13
├── request-context.interceptor.ts  traceparent → traceId/spanId §12
├── pino-bootstrap.ts             logger disponible avant le conteneur DI §29
├── logging.module.ts             LoggerModule.forRootAsync, @Global
└── index.ts

backend/src/config/logging.config.ts        namespace typé des 12 variables LOG_*
backend/test/logging/logging.e2e-spec.ts    les 7 tests §39 ci-dessous
```

**Trois fichiers du §37 n'ont volontairement pas été créés.** La liste de dossiers du §37 est antérieure à EVT-009/EVT-010 : `request-id.middleware.ts` et `exception-logging.filter.ts` existent déjà sous `common/`. En créer un second de chaque aurait donné deux générateurs d'identifiant produisant des valeurs différentes (donc un champ de corrélation qui ne corrèle pas) et deux lignes de log par exception — ce que le §3.4 « une erreur, un log » interdit explicitement. Les deux existants sont réutilisés : `HttpExceptionFilter` journalise désormais via Pino, et `RequestIdMiddleware` partage son identifiant avec `pino-http` par une fonction idempotente (`ensureRequestId`), de sorte que l'ordre d'exécution des middlewares n'a plus d'importance.

### C-24 — la correction demandée était elle-même incomplète

Le §30 mélange des chemins réels et des **clés nues**. Une clé nue est un chemin *racine* pour Pino, donc `password` ne protégeait que `{password: …}` au tout premier niveau. La correction prévue était d'ajouter les wildcards `*.password`, `*.accessToken`, etc.

**Vérifié contre la documentation de Pino et en l'exécutant : `*` ne couvre qu'un seul niveau.** Avec `paths: ['password', '*.password']`, la valeur dans `{a: {b: {password: 'x'}}}` sort **en clair**. `**` est accepté par le parseur mais ne récurse pas davantage.

Livré : les chemins tels que corrigés (couche rapide pour les formes connues) **plus** `scrubSensitiveKeys`, un parcours récursif indépendant de la profondeur, insensible à la casse, branché sur `formatters.log`. Profondeur bornée à 8 pour qu'un objet cyclique dégrade au lieu de bloquer le processus dans une instruction de log.

### C-25 — les serializers, spécifiés

Le §37 promet `log-serializers.ts`, le §40 dit « ajouter serializers sûrs », aucun n'en spécifie un. Les défauts de `pino-std-serializers` ne pouvaient pas être conservés : ils émettent **tous** les en-têtes et l'URL **avec sa query string**, soit trois violations simultanées (§41 interdit les en-têtes complets, §30 exige la suppression d'`authorization`/`cookie`, §31 interdit les données personnelles). Les serializers livrés sont des **listes blanches** : un en-tête apparaît parce qu'il a été nommé, jamais parce qu'il était présent. IP tronquée en `197.0.x.x` (§31), query string supprimée, `err: {type, message, stack}`.

### Quatre défauts trouvés en exécutant réellement

| Défaut | Comment il a été trouvé | Correction |
|---|---|---|
| **Fuite de secret dans les logs** — le filtre construisait `operation` depuis `originalUrl`, query string comprise : `"operation":"GET /api/v1/nope?token=LEAKCANARY123"`. Le champ RFC 9457 `instance` le renvoyait aussi dans la réponse | démarrage réel + `grep` d'un canari dans stdout ; **aucun test existant ne le voyait** | `stripQueryString()` appliqué à `instance`, plus un test de non-régression e2e sur le chemin d'erreur |
| **`err` sortait en `{"type":"NonError","message":"[object Object]"}`** pour chaque 5xx — soit précisément l'information dont l'astreinte a besoin | sortie e2e en JSON | `pino-http` enveloppe le serializer `err` dans `wrapErrorSerializer`, qui applique d'abord le serializer standard et passe le **résultat** au nôtre. `serializeError` est rendu idempotent |
| **`category`/`eventCode` dupliqués et faux** — via `customProps`, ils étaient liés au logger enfant de la requête, donc *tous* les logs métier et sécurité étaient étiquetés `HTTP_ACCESS` / `HTTP_REQUEST_COMPLETED` | lecture de la sortie NDJSON réelle | déplacés vers `customSuccessObject`/`customErrorObject`, qui ne s'appliquent qu'à la ligne finale. Seul `requestId`, stable, reste dans `customProps` |
| **Ligne de démarrage sans `msg`** — `Logger.log(fields, 'Application started')` classait le message dans `context` | démarrage réel | `Logger` implémente `LoggerService` de Nest (`log(message, …, context)`), pas la signature Pino. `PinoLogger` étant *request-scoped*, `app.get()` le refuse ; la ligne passe par le logger de processus |

Également corrigé : `LoggerModule` enregistrait sa middleware sur `path: '*'`, ré-émettant l'avertissement `LegacyRouteConverter` corrigé en EVT-010. Passé à `forRoutes: ['*path']`.

### Une lacune de configuration trouvée dans EVT-008

La règle 3 (`LOG_REDACTION_ENABLED` obligatoire) ne couvrait que `production`. Or `staging` est une valeur valide de `NODE_ENV` dans le schéma, et le §16 dit de staging, sans réserve, « La redaction ne doit jamais être désactivée » — un environnement de staging contient de vrais utilisateurs invités et de vraies clés d'intégration. La règle couvre désormais les deux.

### Vérification réelle, pas déclarative

| Scénario | Résultat observé |
|---|---|
| Démarrage réel, `LOG_FORMAT=json` | NDJSON sur stdout, `{"level":"info",…,"eventCode":"APPLICATION_STARTED","category":"SYSTEM","msg":"Application started"}` |
| Requête avec `Authorization`, `Cookie` **et** `?token=` portant le même canari | **0 occurrence** du canari dans l'intégralité de stdout |
| `X-Request-Id` client valide | identique dans l'en-tête de réponse, `meta.requestId` **et** chaque ligne de log |
| 5xx | une seule ligne `error`, `err.stack` présent dans le log, **absent** de la réponse |
| `/health/live`, `/metrics` | aucune ligne d'accès |
| Avertissements de dépréciation au démarrage | **0** |

Suite `test/logging/logging.e2e-spec.ts` (7 tests) : la sortie est lue comme un collecteur la lirait, en NDJSON, via un flux de destination injecté. La première version interceptait `process.stdout.write` — Pino écrit par `sonic-boom` **directement sur le descripteur 1**, donc elle n'attrapait rien et validait un tableau vide. Corrigé en remplaçant le flux, pas la fonction.

**Principe du Document D §30, à ne pas oublier** — « la redaction est une défense secondaire. La première règle est de ne pas transmettre le secret au logger. » La fuite trouvée ci-dessus en est l'illustration exacte : la redaction fonctionnait, mais le secret était recopié dans un champ que personne n'avait pensé à couvrir.

**Hors scope, explicitement** — OpenTelemetry (§12 le séquence après la corrélation ; un `traceparent` entrant est déjà honoré), instrumentation Prisma/Redis/BullMQ (§23-25, ces sous-systèmes n'existent pas encore), centralisation et rétention (§33-34, du ressort du déploiement).

---

## EVT-012 — Health checks et métriques
<a id="evt-012"></a>

> ✅ **Fait le 31 juillet 2026.** Les trois sondes et les 11 métriques sont **vérifiées sur une instance réellement démarrée contre le PostgreSQL et le Redis de `docker-compose`** — `/health/ready` répond `200`, ce qui est le critère de sortie du sprint 02 dans [`IMPLEMENTATION_ROADMAP.md`](../IMPLEMENTATION_ROADMAP.md).

```
Branche  feat/EVT-012-health-metrics
Commit   feat(observability): add health checks and Prometheus metrics
Routes   GET /api/v1/health/live · /health/ready · /health/startup · /metrics
```

### Structure livrée

```
backend/src/infrastructure/health/
├── health.constants.ts             délai de sonde, clés d'indicateur
├── dependency-probe.ts             timeout dur + ne lève jamais
├── database.health-indicator.ts    SELECT 1 sur un pool pg dédié (max: 1)
├── redis.health-indicator.ts       PING, connexion paresseuse
├── startup.state.ts                bascule sur onApplicationBootstrap
├── health.controller.ts            live / ready / startup
├── health.module.ts
└── index.ts

backend/src/infrastructure/metrics/
├── metrics.constants.ts            liste blanche de labels, buckets
├── assert-allowed-labels.ts        refuse un label non borné au chargement
├── metric-definitions.ts           les 11 métriques §36
├── metrics.service.ts              registre isolé + métriques par défaut
├── http-metrics.middleware.ts      http_requests_total + durée
├── metrics.controller.ts           GET /metrics, texte Prometheus brut
├── metrics.module.ts
└── index.ts

backend/src/common/api/raw-response.decorator.ts   exemption d'enveloppe
backend/test/observability/health-metrics.e2e-spec.ts   les 15 tests ci-dessous
```

### `live` et `ready` ne sont pas la même chose — et le code le prouve

`/health/live` ne consulte **aucune** dépendance, ce qu'un test asserte explicitement. Toute dépendance atteignable depuis `live` est une dépendance dont la panne redémarre la flotte entière : Redis tombe, `live` échoue, l'orchestrateur tue le pod, le pod redémarre, Redis est toujours absent, boucle. Le test « Redis down » vérifie les deux moitiés : `live` reste `200`, `ready` passe `503`.

### Un défaut trouvé en testant : le filtre global effaçait le diagnostic

Terminus signale l'échec **en levant**, et son exception porte le détail par indicateur. Laissée telle quelle, cette exception atteignait le `HttpExceptionFilter` global (EVT-010), qui mappe toute exception non reconnue vers un `DEPENDENCY_UNAVAILABLE` nu : statut correct, **détail perdu**. Un opérateur apprenait qu'*une* dépendance manquait, jamais **laquelle** — c'est-à-dire toute la valeur diagnostique de la sonde. Trouvé parce qu'un test e2e assertait sur le corps, pas seulement sur le statut.

Corrigé en traduisant l'échec dans l'enveloppe du projet : un `errors[]` par dépendance tombée, ce qui conserve un contrat de réponse unique (ADR-0008) tout en nommant le coupable :

```json
"errors": [{ "field": "redis", "code": "DEPENDENCY_DOWN", "message": "redis is unreachable" }]
```

### Un second défaut : les 404 n'étaient comptés nulle part

`http_requests_total` était d'abord alimenté par un intercepteur global. Or **un intercepteur ne s'exécute pas quand aucune route ne correspond** : chaque `404` sur un chemin inconnu était invisible — et un pic de 404 est précisément le signal utile (client cassé, ou énumération de l'API). Converti en middleware enregistrant sur l'événement `finish` de la réponse, ce qui couvre toutes les requêtes tout en laissant `req.route` peuplé pour celles qui ont matché. C'est l'approche qu'emploie `pino-http`, pour la même raison.

### Cardinalité — la règle est *appliquée*, pas seulement documentée

`assertAllowedLabels` lève au chargement du module si une métrique déclare un label hors liste blanche, avec un message distinguant « non borné » (`userId`, `email`, `sessionId`, `requestId`, `organizationId`) de « pas sur la liste ». Le même raisonnement fail-closed que les règles d'environnement : un démarrage qui refuse coûte peu, un stockage de métriques qui meurt sous la cardinalité coûte cher.

Le piège subtil est ailleurs : le label `route` est *autorisé*, mais une **valeur** de chemin concret (`/events/evt_01/sessions/ses_09`) crée une série par identifiant. Le middleware n'enregistre donc que le **gabarit** Express (`/events/:eventId`), et les requêtes sans route sont regroupées sous un unique `unmatched` — compter les 404 est utile, enregistrer leurs chemins donnerait à un attaquant le contrôle direct du nombre de séries.

### `/metrics` ne peut pas porter l'enveloppe

Prometheus rejette tout ce qui n'est pas son format texte. Envelopper `/metrics` dans `data`/`meta`/`error` n'aurait pas dégradé la supervision, elle l'aurait **éteinte**. D'où `@RawResponse()`, un décorateur délibérément étroit que `ResponseEnvelopeInterceptor` honore — réservé aux cas où un protocole externe impose la forme de la réponse.

### Les 11 métriques existent dès maintenant, même celles que rien n'incrémente

Une alerte sur `rate(login_failures_total[5m])` ne se déclenche pas quand la série est **absente** : elle vaut « pas de données », et une alerte qui ne se déclenche jamais ressemble à un système sain. Les 11 sont donc enregistrées à zéro, et le ticket qui alimentera chacune est nommé à côté de sa définition.

### Vérification réelle, pas déclarative

Instance démarrée contre les conteneurs `docker-compose` réels :

| Scénario | Résultat observé |
|---|---|
| `/health/live`, `/health/startup` | `200` |
| `/health/ready` avec PostgreSQL **et** Redis réels | `200`, `{"database":{"status":"up","durationMs":77},"redis":{"status":"up","durationMs":37}}` |
| `/health/ready` avec identifiants erronés | `503` nommant **les deux** dépendances, **sans** fuite du mot de passe ni de l'URL |
| `/metrics` | `Content-Type: text/plain; charset=utf-8; version=0.0.4`, corps Prometheus brut, **pas** d'enveloppe JSON |
| Les 11 noms §36 | tous présents |
| Labels interdits (`userId`, `email`, `sessionId`, `requestId`, `organizationId`) | **0 occurrence** |
| Séries `http_requests_total` | gabarits uniquement : `route="/api/v1/health/live"`, etc. |
| §19 — `/health/*` et `/metrics` hors logs d'accès | **0 ligne** `HTTP_REQUEST_COMPLETED` les mentionnant |
| Avertissements au démarrage | **0** |

**Ce que l'échec d'authentification a prouvé au passage** — la première tentative a rapporté les deux dépendances `down` alors que les conteneurs étaient sains : le `.env` local portait des identifiants périmés. `SELECT 1` et `PING` traversent l'authentification ; un simple test de connexion TCP aurait déclaré ces dépendances saines. C'est exactement l'état que la readiness existe pour attraper.

**Limites assumées** — les indicateurs possèdent leurs propres clients (`pg` en pool de 1, client `redis` paresseux) parce que `PrismaService` et le module Redis partagé arrivent en sprint 03 ; les `TODO(EVT-014)` / `TODO(EVT-016)` marquent leur remplacement. La vérification des « migrations compatibles » du §15.2 est reportée avec Prisma. `/health/*` et `/metrics` sont non authentifiés et exempts de CSRF ([ADR-0016](../../adr/0016-pre-session-csrf-binding.md)) ; leur non-exposition hors du cluster relève de l'ingress, donc d'EVT-013.

**Scope** — Terminus avec indicateurs PostgreSQL et Redis ; prom-client avec les 11 métriques nommées du Document D §36.

### `live` et `ready` ne sont pas la même chose

| Route | Vérifie | Échoue quand |
|---|---|---|
| `/health/live` | le processus répond | le processus est bloqué ou mort |
| `/health/ready` | PostgreSQL, Redis, migrations compatibles | une dépendance manque |
| `/health/startup` | l'initialisation est terminée | le démarrage est en cours |

Les confondre fait **redémarrer en boucle** un service simplement dégradé : Redis tombe, `live` échoue, l'orchestrateur tue le pod, le pod redémarre, Redis est toujours absent, boucle. Avec la séparation, le service reste vivant et sort simplement du pool de routage.

**Labels de métriques autorisés** — `route`, `method`, `status`, `category`, `queueName`, `service`, `environment`. **Jamais** `userId`, `email`, `sessionId`, `requestId`, `organizationId` : cardinalité non bornée, ce qui fait exploser le stockage de métriques.

**Note** — `/health/*` et `/metrics` sont exemptés de CSRF et échantillonnés côté logs (Document D §19).

---

## EVT-013 — Dockerfiles
<a id="evt-013"></a>

> ✅ **Fait le 31 juillet 2026.** Les deux images sont **réellement construites**, les **5 services démarrent**, et `/health/ready` répond `200` **depuis l'extérieur du conteneur** — le critère de vérification du ticket.

```
Branche  feat/EVT-013-dockerfiles
Commit   feat(infra): add multi-stage Dockerfiles for backend and web
```

**Scope** — `backend/Dockerfile`, `web/Dockerfile`, `.dockerignore` pour chacun, ajout des deux services au compose.

### Structure livrée

```
backend/Dockerfile               4 étapes : deps → build → prod-deps → runtime
backend/.dockerignore
backend/docker-healthcheck.mjs   sonde /api/v1/health/live en Node pur
web/Dockerfile                   3 étapes : deps → build → runtime (standalone)
web/.dockerignore
web/docker-healthcheck.mjs
web/next.config.ts               output: "standalone", poweredByHeader: false
docker/docker-compose.yml        + services backend et web
docker/.env.example              + API_PORT, WEB_PORT
```

### Les exigences, et comment chacune est vérifiée

| Exigence | Vérification exécutée |
|---|---|
| Multi-étapes, aucune dépendance de build dans l'image finale | `test -d /app/src` → absent · `jest` → absent · `@nestjs/cli` → absent |
| Utilisateur **non-root** | `docker exec … id` → backend `uid=1000(node)`, web `uid=1001(nextjs)` |
| `.dockerignore` excluant `.env`, `node_modules`, `.git` | `/app/.env` → **0** occurrence dans les deux images · `/app/.git` → absent |
| `HEALTHCHECK` sur `/health/live` | `["CMD","node","docker-healthcheck.mjs"]`, les 5 conteneurs rapportent `(healthy)` |
| `STOPSIGNAL SIGTERM` propagé | `docker stop` → **code de sortie 0 en 0 s**, pas le SIGKILL à 10 s |
| `docker compose up` démarre les 5 services | `backend`, `web`, `postgres`, `redis`, `pgadmin` tous `(healthy)` |
| `/health/ready` répond depuis l'extérieur | `200`, `{"database":{"status":"up"},"redis":{"status":"up"}}` |

### Décisions notables

**`bookworm-slim` (glibc) plutôt qu'Alpine (musl).** `argon2` et `sharp` embarquent du code natif et publient des binaires précompilés glibc. Sur musl, ils sont soit compilés depuis les sources — ce qui impose une chaîne de compilation dans l'image — soit résolus via des paquets optionnels `-musl` que npm ignore silencieusement quand la plateforme d'installation et la cible divergent. Le résultat est un module qui s'installe proprement et échoue à la première utilisation : le pire endroit pour l'apprendre.

**`node dist/main`, jamais `npm start`.** npm ne transmet pas SIGTERM à son enfant : `enableShutdownHooks()` (EVT-009) ne serait jamais appelé et chaque arrêt deviendrait un SIGKILL, coupant les transactions en cours. Mesuré : arrêt en 0 s avec code 0.

**Le healthcheck vise `live`, jamais `ready`.** L'action que prend Docker — comme tout orchestrateur — sur un healthcheck en échec est de **tuer et redémarrer**. Le pointer sur `ready` ferait redémarrer en boucle tous les conteneurs pendant une panne Redis : exactement la confusion qu'EVT-012 existe pour éviter.

**Healthcheck écrit en Node, pas en `curl`.** L'image runtime n'a ni `curl` ni `wget`. En installer un ajouterait un client HTTP pilotable depuis un shell à une image qui n'en a aucun — utile à un attaquant, inutile ici.

**`NODE_ENV=development` dans le compose, `production` dans l'image.** L'image vise le déploiement ; la stack locale est en http sur localhost, et `production` **refuserait de démarrer** (règles 2 et 5 : `COOKIE_SECURE=true`, origines https). Surcharger dans le compose est le réglage honnête, plutôt que d'affaiblir les règles.

**`NEXT_PUBLIC_API_BASE_URL` est un `ARG` de build.** Next.js inline les variables `NEXT_PUBLIC_*` dans le bundle client à la construction : elles ne sont pas lues au démarrage. Une image web construite pour un environnement **ne peut donc pas** être promue vers un autre — c'est une propriété de Next.js, pas un choix, et elle est signalée ici plutôt que découverte en production.

### Un point vérifié plutôt que supposé

Les identifiants du compose sont interpolés dans `DATABASE_URL` et `REDIS_URL`. Un `@` dans un mot de passe semblait devoir casser l'analyse ; testé contre les analyseurs réels (`pg-connection-string` et le client `redis`), les deux découpent sur le **dernier** `@` et acceptent la valeur. En revanche `/`, `?` et `#` terminent chacun un composant d'URL : `.env.example` documente cette contrainte réelle, sans en inventer une fausse.

### Taille des images — une dette chiffrée, pas ignorée

| Image | Taille |
|---|---|
| `eventini-web:local` | **378 Mo** |
| `eventini-backend:local` | **1,07 Go** |

Les `node_modules` de production pèsent 576 Mo, dont **302 Mo (52 %) proviennent d'un seul paquet que rien n'importe encore** :

```
@prisma/client@7.9.1
├── @prisma            177 Mo
├── prisma              42 Mo   (le CLI, déclaré en dépendance de runtime)
├── effect              34 Mo   (via @prisma/config)
├── @electric-sql       26 Mo   (via @prisma/dev — pglite embarqué)
└── typescript          23 Mo
```

`@prisma/client` v7 déclare le CLI `prisma` — et donc `@prisma/dev`, un paquet d'outillage local — comme dépendance de **runtime**. Aucun contournement propre n'existe sans casser ce dont le sprint 03 aura besoin, donc rien n'est bricolé ici : le chiffre est mesuré, publié, et **EVT-014** est le ticket qui configurera Prisma et devra le reprendre.

**Limites assumées** — pas de scan de vulnérabilité d'image (Trivy/Grype) dans la CI ; pas de `docker build` en CI non plus, donc une régression de Dockerfile ne serait pas détectée avant un `up` local. Le tag de base n'est pas épinglé par digest, délibérément : `node:24-bookworm-slim` est reconstruit pour absorber les correctifs de sécurité Debian, et la reproductibilité vient de `package-lock.json`. L'exposition de `/health/*` et `/metrics` hors du cluster reste une affaire d'ingress, non traitée par un compose local.

**Exigences**

| Exigence | Pourquoi |
|---|---|
| Multi-étapes | l'image finale ne contient aucune dépendance de build ni code source TypeScript |
| Utilisateur **non-root** | une exécution root dans un conteneur transforme une évasion en compromission de l'hôte |
| `.dockerignore` incluant `.env`, `node_modules`, `.git` | évite de copier des secrets dans une couche d'image — une couche supprimée reste dans l'historique |
| `HEALTHCHECK` pointant sur `/health/live` | |
| Signal d'arrêt propagé (`STOPSIGNAL SIGTERM`) | sans quoi `enableShutdownHooks` ne sert à rien |

**Vérification** — `docker compose up` démarre les 5 services ; `/health/ready` répond depuis l'extérieur du conteneur.

---

## Risques de ce sprint

| Risque | Atténuation |
|---|---|
| Un secret par défaut est laissé dans `configuration.ts` « pour le développement » | Règle 9 de la validation : refuser toute valeur d'exemple connue |
| `trust proxy: true` est écrit par facilité | Job `security.yml` → « No blanket trust proxy », bloquant |
| Les 13 fichiers de logging sont créés mais restent partiellement vides | Test : un mot de passe passé au logger doit être absent de la sortie |
| `/health/ready` retourne `200` sans réellement tester les dépendances | Test : arrêter Redis, `ready` doit passer en `503` |
