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

```
Branche  feat/EVT-010-response-envelope
Commit   feat(api): add RFC 9457 response envelope and exception filter
```

**Scope** — `ResponseEnvelopeInterceptor`, `HttpExceptionFilter` RFC 9457, catalogue `error-codes.ts`, middleware `X-Request-Id`.

**Référence** — [`API_CONVENTIONS.md` §3-4](../../api/API_CONVENTIONS.md), [ADR-0008](../../adr/0008-response-envelope-rfc9457.md).

**Règle du log unique** — le filtre global journalise **une fois**. Le controller ne rejournalise jamais. Journaliser à chaque couche produit quatre lignes pour un incident et rend tout comptage d'erreurs faux.

**Tests**

- toute réponse porte `data`, `meta`, `error` ;
- `meta` porte **toujours** `requestId`, `timestamp`, `apiVersion` ;
- un `500` déclenché ne contient **aucune** trace d'exécution, aucune erreur Prisma, aucun nom de table ;
- `X-Request-Id` fourni par le client est conservé s'il est valide, remplacé sinon, et toujours renvoyé.

---

## EVT-011 — Logging Pino
<a id="evt-011"></a>

```
Branche  feat/EVT-011-pino-logging
Commit   feat(logging): implement structured Pino logging with redaction
```

**État actuel** — `backend/src/infrastructure/logging/` contient **13 fichiers de 0 octet**. Le sous-système entier est vide.

**Scope** — remplir les 13 fichiers : module, config, redaction, serializers, event codes, catégories, `request-id.middleware`, `request-context.service`, `request-context.interceptor`, filtre d'erreurs.

**Référence** — [`PINO_LOGGING_SPECIFICATION.md`](../../observability/PINO_LOGGING_SPECIFICATION.md) (Document D) fait autorité sur le schéma de champs, les niveaux, les catégories et la rétention.

### Deux corrections à apporter au Document D

| # | Problème | Correction |
|---|---|---|
| **C-24** | Les chemins de redaction §30 mélangent chemins réels (`req.headers.authorization`) et **clés nues** (`password`, `accessToken`, `mfaSecret`). Une clé nue ne matche que la racine de l'objet — ce ne sont **pas** des `redact.paths` Pino valides | Ajouter les wildcards : `*.password`, `*.accessToken`, `*.refreshToken`, `*.mfaSecret`, … |
| **C-25** | La §37 promet `log-serializers.ts` et la §40 dit « ajouter serializers sûrs », **sans jamais en spécifier un seul** | Spécifier les serializers `req`, `res`, `err`. La seule forme implicite du corpus est `err: {type, message, stack}` |

**Tests obligatoires**

- un mot de passe passé au logger **n'apparaît pas** en sortie ;
- un `Authorization` ou un `Cookie` complet n'apparaît pas ;
- `requestId` présent sur **chaque** ligne ;
- `LOG_LEVEL=silent` en test produit zéro sortie ;
- `LOG_REDACTION_ENABLED=false` est **refusé** si `NODE_ENV` vaut `staging` ou `production`.

**Principe du Document D §30, à ne pas oublier** — « la redaction est une défense secondaire. La première règle est de ne pas transmettre le secret au logger. »

---

## EVT-012 — Health checks et métriques
<a id="evt-012"></a>

```
Branche  feat/EVT-012-health-metrics
Commit   feat(observability): add health checks and Prometheus metrics
Routes   GET /api/v1/health/live · /health/ready · /health/startup · /metrics
```

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

```
Branche  feat/EVT-013-dockerfiles
Commit   feat(infra): add multi-stage Dockerfiles for backend and web
```

**État actuel** — il n'existe **aucun** Dockerfile dans tout le dépôt. Seul le `docker-compose.yml` d'infrastructure (postgres, pgadmin, redis) existe, et il fonctionne.

**Scope** — `backend/Dockerfile`, `web/Dockerfile`, `.dockerignore` pour chacun, ajout des deux services au compose.

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
