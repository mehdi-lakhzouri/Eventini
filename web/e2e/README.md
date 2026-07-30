# End-to-end tests

Playwright specs live here. **Empty on purpose.**

There is no working flow to exercise yet: `AppProviders` is unmounted, seven
files import a `../types` barrel that does not exist, and the API client points
at a backend with zero reachable routes.

The first real specs land in **sprint 07** (EVT-037 → EVT-041), once
authentication reaches the browser:

| Spec | Proves |
|---|---|
| `authentication.spec.ts` | login, session kept alive by rotation, logout |
| `single-flight-refresh.spec.ts` | ten parallel `401`s trigger **one** rotation, not ten |
| `route-guards.spec.ts` | an unauthenticated visit to a protected route redirects |
| `organization-switch.spec.ts` | switching context clears the client cache |

`playwright.config.ts` is configured and runnable now (`npm run test:e2e`),
but it is **not** a required CI check until those specs exist — a suite that
asserts nothing must not report green.

See [`docs/sprints/sprint-07/README.md`](../../docs/sprints/sprint-07/README.md).
