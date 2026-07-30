# Backend test suites

Three runners, three scopes. Jest configs are plain JSON and cannot carry
comments, so the rationale lives here.

| Suite | Config | Pattern | Command |
|---|---|---|---|
| Unit | inline in `package.json` | `*.spec.ts` under `src/` | `npm test` |
| Integration | `test/jest-integration.json` | `*.integration-spec.ts` | `npm run test:integration` |
| End-to-end | `test/jest-e2e.json` | `*.e2e-spec.ts` | `npm run test:e2e` |

## Integration tests run against real infrastructure

PostgreSQL and Redis from `docker/docker-compose.yml`. **Never SQLite, never a
mock.**

A different engine does not enforce the same constraints, and the constraints
are what carry the guarantees:

- `ux_attendance_checkin_unique` is what makes a duplicate check-in impossible,
  not application code;
- `ux_refresh_active_per_family` is what serialises two concurrent token
  rotations, not a Redis lock;
- `ux_idempotency_scope` is what makes the idempotency reservation atomic.

Testing those against a substitute engine proves nothing about production.

`maxWorkers: 1` because these suites share one database. Parallel workers would
race on the same tables and produce failures that look like flakiness but are
really contention.

`testTimeout: 30000` because container startup and migrations are slow compared
to a unit test.

## Current state

Both the integration and e2e suites are **empty**. `--passWithNoTests` keeps
them from failing the build before they exist.

The repository currently holds **2 real assertions** and **31 `it.todo`
placeholders**. CI enforces a budget so that number can only go down — see the
*Placeholder-test budget* step in `.github/workflows/ci.yml`.

| Suite | Becomes a required check | Ticket |
|---|---|---|
| Integration | sprint 03 | EVT-019 — the 12 cross-table invariants |
| E2E | sprint 04 | EVT-023, EVT-024 — login and rotation |
| Architecture | sprint 06 | EVT-036 — tenant isolation |

See [`docs/architecture/BACKEND_ARCHITECTURE.md` §11](../../docs/architecture/BACKEND_ARCHITECTURE.md).
