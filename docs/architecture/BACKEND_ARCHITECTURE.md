# Eventini — Architecture backend

> **Statut :** Spécification normative + état vérifié · **Version :** 1.0 · **Date :** 30 juillet 2026
> **Stack :** NestJS 11 · Prisma 7.9 · PostgreSQL 18.4 · Redis 8.8 · BullMQ 5 · Pino 10
> **Racine réelle : `backend/`** — les Documents B §10 et D §37 écrivent `api/`, ce répertoire **n'existe pas**

---

## 1. État vérifié

| Élément | Réel |
|---|---|
| Routes atteignables | **0** |
| `@Controller` | 2, corps vides |
| `@Injectable()` | **0** dans tout le backend |
| Passport strategies | 0 |
| `JwtAuthGuard`, `ScannerGuard` | **n'existent pas**, même en squelette |
| `PermissionsGuard`, `RolesGuard`, `ResourceAccessGuard`, `TenantContextGuard`, `CsrfGuard` | existent comme **classes vides**, aucune n'implémente `CanActivate` |
| `main.ts` | 8 lignes, aucun middleware |
| `src/config/*` | 7 × `export const xConfig = {};` |
| `src/common/*` | 9 répertoires, chacun un `index.ts` = `export {};` |
| ~~`src/shared/*`~~ | ~~6 répertoires, uniquement des `.gitkeep`~~ — ✅ **supprimé par EVT-004** |
| `src/infrastructure/logging/*` | **13 fichiers de 0 octet** |
| Modules métier hors identity | 14 répertoires, chacun un `index.ts` d'1 octet |

Ce qui **existe réellement** et mérite d'être conservé :

- le câblage DI de `IdentityModule` et de ses 9 sous-modules — le graphe est valide ;
- `src/__architecture__/modularity.spec.ts` — le seul test réel du dépôt, qui vérifie que les modules n'importent pas les internes les uns des autres ;
- la découpe en couches par module (`application/`, `domain/`, `infrastructure/`, `controllers/`, `dto/`).

**Piège DI latent** : aucune classe enregistrée comme provider ne porte `@Injectable()`. Nest le tolère aujourd'hui parce qu'aucune n'a de paramètre de constructeur. **Ajouter une seule dépendance à l'une d'elles fera échouer le bootstrap.**

---

## 2. Arborescence cible

```
backend/
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
├── scripts/                        → symlink ou copie de ../scripts/redis
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   ├── configuration.ts             namespaces typés
│   │   ├── validation.schema.ts         validation BLOQUANTE au démarrage
│   │   ├── application.config.ts
│   │   ├── authentication.config.ts
│   │   ├── cookies.config.ts
│   │   ├── csrf.config.ts
│   │   ├── database.config.ts
│   │   ├── redis.config.ts
│   │   └── rate-limit.config.ts
│   ├── common/
│   │   ├── api/
│   │   │   ├── response-envelope.interceptor.ts
│   │   │   ├── http-exception.filter.ts        RFC 9457
│   │   │   ├── error-codes.ts                  catalogue unique
│   │   │   └── pagination/                     curseur opaque signé
│   │   ├── idempotency/
│   │   ├── concurrency/
│   │   ├── decorators/                  @Public @RequirePermission @Idempotent
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── pipes/
│   │   ├── filters/
│   │   ├── middleware/
│   │   └── types/
│   ├── infrastructure/
│   │   ├── database/
│   │   │   ├── prisma.module.ts
│   │   │   ├── prisma.service.ts
│   │   │   ├── tenant-scope.extension.ts       ← la garde d'isolation
│   │   │   └── transaction.manager.ts
│   │   ├── redis/                       5 connexions + registre de scripts Lua
│   │   ├── queue/                       BullMQ
│   │   ├── logging/                     Pino (13 fichiers actuellement vides)
│   │   ├── metrics/                     prom-client
│   │   ├── health/                      Terminus
│   │   ├── email/                       nodemailer + handlebars
│   │   ├── storage/
│   │   └── outbox/                      publieur
│   ├── modules/
│   │   ├── identity/                    9 sous-modules — déjà câblés
│   │   ├── users/
│   │   ├── organizations/
│   │   ├── events/
│   │   ├── event-sessions/
│   │   ├── participants/
│   │   ├── registrations/
│   │   ├── tickets/
│   │   ├── scanners/
│   │   ├── attendance/
│   │   ├── reporting/
│   │   ├── notifications/
│   │   ├── audit/
│   │   ├── realtime/
│   │   └── platform-administration/
│   └── __architecture__/                tests de frontières
└── test/                                e2e
```

> ✅ **Résolu par EVT-004** (30 juillet 2026) : le squelette DDD parallèle non documenté (`src/application/`, `src/domain/`, `src/presentation/` — 0 fichier chacun, jamais suivis par git) et `src/shared/` (6 `.gitkeep`) ont été supprimés. Deux taxonomies concurrentes garantissaient que le code finirait réparti au hasard entre les deux.

---

## 3. Les 4 couches d'un module

```
modules/events/
├── controllers/          HTTP uniquement — parse, délègue, présente
├── application/          use cases — orchestration, transactions
├── domain/               entités, policies, erreurs, ports (interfaces)
├── infrastructure/       adaptateurs — Prisma, Redis, mail
├── dto/                  validation d'entrée + présenteurs de sortie
├── events.module.ts
└── index.ts              SEULE surface publique du module
```

| Couche | Peut dépendre de | Ne peut jamais |
|---|---|---|
| `controllers` | `application`, `dto` | toucher Prisma, contenir une règle métier |
| `application` | `domain`, ports | connaître HTTP, connaître Prisma |
| `domain` | rien | dépendre d'un framework |
| `infrastructure` | `domain` (implémente ses ports) | être appelée par un controller |

**Un controller qui appelle Prisma est un bug d'architecture**, pas un raccourci. C'est la règle 7 des règles obligatoires pour agent IA du contexte produit §21.

`domain/` ne dépend de rien — ni Nest, ni Prisma, ni Express. C'est ce qui permet de tester les règles métier sans base ni conteneur.

---

## 4. Bootstrap — ce que `main.ts` doit faire

Aujourd'hui 8 lignes. Cible, dans cet ordre :

```ts
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));                      // Pino, avant tout log
  app.set('trust proxy', config.trustedProxyHops);     // JAMAIS `true`
  app.use(helmet(helmetOptions));                      // + CSP
  app.enableCors(corsOptions);                         // origines exactes
  app.use(cookieParser(config.cookieSecret));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,                        // anti mass assignment
    transform: true,
    transformOptions: { enableImplicitConversion: false },
  }));
  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableShutdownHooks();

  if (config.swaggerEnabled) setupSwagger(app);        // protégé hors dev

  await app.listen(config.port);
}
```

**Points non négociables**

| Point | Pourquoi |
|---|---|
| `trust proxy` avec un nombre de sauts explicite | `true` laisse n'importe qui forger `X-Forwarded-For` et contourner tout rate limiting par IP |
| `forbidNonWhitelisted: true` | rejette `{"status": "ACTIVE"}` glissé dans un corps — c'est la défense anti mass assignment |
| `enableImplicitConversion: false` | la conversion implicite transforme `"0"` en `false` et crée des failles de validation subtiles |
| `enableShutdownHooks` | sans lui, un arrêt coupe les transactions en cours et laisse des jobs orphelins |
| `bufferLogs: true` | sinon les logs de démarrage échappent à Pino et à la redaction |

### `AppModule`

Aujourd'hui : `imports: [IdentityModule]`. Cible :

```ts
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration],
                           validationSchema, validationOptions: { abortEarly: false } }),
    LoggerModule.forRootAsync(...),      // nestjs-pino
    PrismaModule,
    RedisModule,
    QueueModule,
    MetricsModule,
    HealthModule,
    OutboxModule,
    IdentityModule,
    OrganizationsModule, EventsModule, EventSessionsModule,
    ParticipantsModule, RegistrationsModule, TicketsModule,
    ScannersModule, AttendanceModule, ReportingModule,
    NotificationsModule, AuditModule, RealtimeModule,
    PlatformAdministrationModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthenticationGuard },   // ordre = ordre d'exécution
    { provide: APP_GUARD, useClass: TenantContextGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
})
```

**Les guards sont globaux ; l'accès public est un opt-in explicite** via `@Public()`. C'est l'inverse du réflexe courant, et c'est délibéré : une route nouvelle est protégée par défaut. Avec des guards posés route par route, l'oubli d'un décorateur crée une route ouverte silencieuse.

La validation d'environnement est **bloquante** : une variable manquante ou invalide fait échouer le démarrage avec un log `fatal` et un code de sortie non nul. Une valeur par défaut silencieuse en production est la source classique de la mauvaise configuration (OWASP A05).

---

## 5. Ordre des guards

```
CsrfGuard → AuthenticationGuard → TenantContextGuard → PermissionsGuard → ResourceGuard
```

| Guard | Étapes | Refus |
|---|---|---|
| `CsrfGuard` | méthode, Origin, cookie, header, signature, liaison | `403 AUTH_CSRF_INVALID` |
| `AuthenticationGuard` | 1-3 : token, session, utilisateur | `401` |
| `TenantContextGuard` | 4-5 : organisation, membership → injecte `TenantContext` | `403 AUTH_TENANT_DENIED` |
| `PermissionsGuard` | 6 : permission effective | `403 AUTH_PERMISSION_DENIED` |
| `ResourceGuard` | 7-8 : propriété + état — **dans le use case**, pas en guard global | `403` / `409` |

Les étapes 7-8 ne peuvent pas être un guard global : elles exigent de charger la ressource, ce qui est le travail du use case. Elles sont implémentées par une méthode de repository qui **exige** le `TenantContext`, ce que la garde Prisma rend obligatoire.

Détail complet : [`AUTHENTICATION_AUTHORIZATION.md` §6](../security/AUTHENTICATION_AUTHORIZATION.md).

---

## 6. Isolation multi-tenant

### L'extension Prisma

```ts
const tenantScopeExtension = Prisma.defineExtension({
  name: 'eventini-tenant-scope',
  query: {
    $allModels: {
      async $allOperations({ model, operation, args, query }) {
        if (TENANT_OWNED_MODELS.has(model) && !isUnscopedContext()) {
          if (!hasOrganizationScope(args))
            throw new TenantScopeViolationError(model, operation);
        }
        return query(args);
      },
    },
  },
});
```

Fail closed : en cas de doute, on refuse. Une échappatoire unique et explicite (`prisma.$unscoped(...)`) est réservée aux opérations plateforme, journalisée en `warn` avec `eventCode: UNSCOPED_QUERY_EXECUTED` — et toute occurrence en production déclenche une alerte.

### Signature de repository

```ts
// obligatoire
findEventById(ctx: TenantContext, eventId: string): Promise<Event | null>

// interdit — ne compile pas si le test d'architecture est actif
findEventById(eventId: string): Promise<Event | null>
```

Le `TenantContext` est le **premier** paramètre, jamais optionnel, jamais un `string` nu. Un `string` se passe par erreur ; un type dédié ne se fabrique que par le guard.

---

## 7. Transactions

```ts
await this.transactionManager.run(async (tx) => {
  const record = await this.attendanceRepo.create(ctx, tx, input);
  await this.outboxRepo.append(ctx, tx, 'ATTENDANCE_RECORDED', payload);
  await this.idempotencyRepo.complete(ctx, tx, key, response);
  return record;
});
// publication APRÈS le commit
```

Publier avant le commit annoncerait un check-in qui n'existe pas si la transaction échoue.

Frontières transactionnelles obligatoires : les 9 du Document B §39, plus les 9 de [`ENTITY_RELATIONSHIPS.md` §7](../database/ENTITY_RELATIONSHIPS.md).

---

## 8. Gestion des erreurs

```
domain/           lève une erreur métier typée (EventNotActiveError)
application/      ajoute le contexte, ne journalise pas
infrastructure/   traduit l'erreur technique (violation d'unicité → ResourceAlreadyExistsError)
filtre global     journalise UNE fois, formate en RFC 9457
controller        ne rejournalise jamais
```

**Une erreur, un log.** Journaliser à chaque couche produit quatre lignes pour un incident et rend le comptage d'erreurs faux.

| Type | Niveau | Trace |
|---|---|---|
| Métier attendu (`RESOURCE_ALREADY_EXISTS`, `VERSION_CONFLICT`) | `info` / `warn` | non |
| Technique inattendu | `error` | oui, **interne uniquement** |
| Impossible de continuer | `fatal` | oui, puis arrêt propre |

Jamais exposé : trace d'exécution, erreur Prisma brute, SQL, nom de table, chemin serveur.

---

## 9. Configuration

`src/config/` contient aujourd'hui 7 objets vides. Cible : des namespaces typés et une validation **bloquante**.

```ts
export const validationSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']),
  PORT: z.coerce.number().int().positive(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  ACCESS_TOKEN_PRIVATE_KEY: z.string().min(1),
  ACCESS_TOKEN_PUBLIC_KEY: z.string().min(1),
  ACCESS_TOKEN_KEY_ID: z.string().min(1),
  PASSWORD_PEPPER: z.string().min(32),
  // … catalogue complet : docs/operations/ENVIRONMENT_VARIABLES.md
});
```

`zod` n'est pas installé côté backend aujourd'hui — seul `class-validator` l'est. Ajouter `zod` uniquement pour l'environnement est justifié : il valide et **type** en une passe, hors du cycle de vie DI, donc utilisable avant que Nest ne démarre. Décision consignée au sprint 02.

Règles : aucune valeur par défaut pour un secret · aucun secret dans le code · démarrage refusé si une variable manque · `abortEarly: false` pour signaler **toutes** les variables manquantes d'un coup.

---

## 10. Frontières de modules

Vérifiées par `src/__architecture__/modularity.spec.ts` — **le seul test réel du dépôt**, déjà fonctionnel.

| Règle | |
|---|---|
| Un module n'importe que l'`index.ts` d'un autre module | jamais ses internes |
| `shared/` n'importe jamais `modules/` | |
| `authorization` dépend de `tenant-access` | jamais l'inverse |
| Les modules métier n'importent jamais les internes d'`identity` | |
| `csrf` peut lire un identifiant de session minimal | rien d'autre |
| `common/` et `infrastructure/` n'importent jamais `modules/` | |

Graphe complet : [`MODULE_DEPENDENCY_MAP.md`](MODULE_DEPENDENCY_MAP.md).

---

## 11. Tests

| Type | Portée | Outil |
|---|---|---|
| Unitaires | use cases, policies, validation, crypto, règles QR, idempotence | Jest |
| Intégration | Prisma + **PostgreSQL réel**, Redis réel, transactions, migrations, BullMQ | Jest + docker-compose |
| E2E | login, refresh, CSRF, isolation tenant, permissions, check-in, doublon, sync offline, scanner révoqué, organisation suspendue | Jest + supertest |
| Architecture | frontières de modules, isolation tenant, imports interdits | Jest |
| Sécurité | les 25 tests négatifs de [`AUTHENTICATION_AUTHORIZATION.md` §11](../security/AUTHENTICATION_AUTHORIZATION.md) | Jest |

Les tests d'intégration tournent contre le PostgreSQL **réel** de docker-compose, jamais SQLite ni un mock : une base différente ne teste pas les mêmes contraintes, et ce sont précisément les contraintes qui portent l'isolation.

État actuel : **2 assertions réelles, 31 `it.todo`**. `supertest` et `@nestjs/testing` sont installés et jamais importés.

---

## 12. Corrections de dépendances

| Paquet | Action | Sprint | Motif |
|---|---|---|---:|
| `@nestjs/jwt` | **retirer** | 04 | redondant avec `jose` ([ADR-0005](../adr/0005-token-signing-eddsa.md)) |
| `@nestjs/throttler` | **retirer** | 05 | ne couvre ni le multi-dimension ni le lockout progressif |
| `zod` | **ajouter** | 02 | validation d'environnement typée hors DI |
| `socket.io`, `@nestjs/websockets` | conserver, inutilisés | — | SSE d'abord ; à retirer si Socket.IO n'est jamais retenu |
| `passport`, `passport-jwt` | **retirer** | 04 | `jose` + un guard suffisent ; aucune strategy n'existe |
| Scripts npm Prisma et `typecheck` | **ajouter** | 03 | aucun n'existe |

`tsconfig` a `noImplicitAny: false` et `strictBindCallApply: false`, et ESLint a `no-explicit-any: 'off'`. Du `any` implicite passerait silencieusement dans du code de sécurité. **Strictness complète activée au sprint 01**, avant que le code de sécurité ne soit écrit — l'activer après imposerait une reprise.
