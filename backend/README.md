# Eventini — backend

NestJS 11 modular monolith. PostgreSQL 18 via Prisma 7, Redis 8 for rate
limiting, lockout and permission caching.

This file replaces the stock NestJS starter README, which advertised the
framework's Discord and a PayPal donation link and told a reader nothing about
this service. Its CircleCI badge also carried an upstream placeholder query
string that the nightly secret scan reported as a leak on every run.

## Running it

The database and Redis come from `docker/docker-compose.yml`:

```bash
docker compose -f ../docker/docker-compose.yml up -d
cp .env.example .env      # then replace every placeholder secret
npm ci
npm run prisma:migrate:deploy
npm run db:seed
npm run start:dev
```

`.env.example` ships loud placeholders — every secret decodes to
`EXAMPLE-DO-NOT-USE-REPLACE-BEFORE-ANY-DEPLOYMENT`. The application **refuses
to start** on them: rule 9 of `src/config/rules/secret-hygiene.rule.ts` reports
them by name. Generate real ones:

```bash
openssl rand -base64 32                      # each symmetric secret, separately
openssl genpkey -algorithm ed25519           # the two signing key pairs
```

Reusing one value across two variables fails rule 8. That separation is the
point: compromising the CSRF key must not also compromise refresh tokens.

## Tests

```bash
npm test                  # unit, no external services
npm run test:integration  # needs DATABASE_URL and REDIS_URL
npm run test:e2e          # needs both, boots the real application
```

Integration and e2e read `DATABASE_URL` and `REDIS_URL` from the environment
and **skip silently when they are absent**, so a bare `npm test` on a fresh
clone stays green. CI supplies both — see `scripts/ci/prepare-test-env.mjs`,
which builds a complete environment with freshly generated secrets.

The e2e suite runs with `maxWorkers: 1`. Database rows are partitioned by a
per-suite suffix, but rate-limit counters are keyed on the client IP and every
request arrives from `127.0.0.1`, so parallel suites share one window and reset
each other's counters mid-test.

## Layout

```
src/common/          envelope, errors, idempotency — no dependency on modules/
src/config/          environment schema and the nine validation rules
src/infrastructure/  Prisma, Redis, metrics, logging
src/modules/         the feature modules; identity/ owns the auth chain
src/__architecture__/ rules enforced as tests: tenant isolation, module edges
```

`src/__architecture__` is not documentation. It fails the build when a
repository on a tenant-owned model omits its `TenantContext`, when a module
reaches past another's public barrel, or when `$unscoped` is called outside its
allow-list.

## Documentation

The specifications live in [`../docs`](../docs). The ones this service is built
against most directly:

- `docs/security/AUTHENTICATION_AUTHORIZATION.md` — the eight-step chain
- `docs/architecture/BACKEND_ARCHITECTURE.md` — layering and bootstrap order
- `docs/database/DATABASE_SCHEMA.md` — normative column lists
- `docs/adr/` — the decisions, with the alternatives that were rejected
