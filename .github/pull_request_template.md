<!--
Title format:  [EVT-014] feat(identity): refresh token rotation
Branch format: feat/EVT-014-refresh-token-rotation
See docs/adr/0017-delivery-model.md
-->

## EVT-___

**What this changes**

<!-- One paragraph. What behaviour is different after this merges. -->

**Why**

<!-- Link the sprint ticket, the ADR, or the spec section that motivates it. -->

- Ticket: `docs/sprints/SPRINT_PLAN.md` → EVT-___
- ADR / spec:

---

## Definition of Done

The 21 items from `EVENTINI_PROJECT_CONTEXT.md` §19. Tick what applies, strike
through what does not with a one-line reason. **An unticked box with no reason
blocks the merge.**

- [ ] Business rule understood
- [ ] Rules documented
- [ ] Database model
- [ ] Migration
- [ ] Constraints and indexes
- [ ] Use case
- [ ] Repository
- [ ] Route / API
- [ ] DTO validation
- [ ] Authorization
- [ ] Tenant isolation
- [ ] Audit / security events
- [ ] Error handling
- [ ] Unit tests
- [ ] Integration tests
- [ ] E2E tests
- [ ] API documentation
- [ ] Frontend connected
- [ ] Observability
- [ ] Build green
- [ ] Proof of execution (paste real output below)

---

## Security impact

**Mandatory as soon as this PR touches authentication, authorization,
multi-tenancy, the database, or any external input.** Delete the section only if
none of those apply.

- [ ] No new route bypasses the guard chain (`@Public()` used deliberately, if at all)
- [ ] Every tenant-scoped query filters on `organization_id`
- [ ] No secret in code, logs, tests, seeds, or error responses
- [ ] Error responses reveal nothing about existence, internals, or stack traces
- [ ] New state-changing route is CSRF-protected
- [ ] New sensitive operation emits a security event
- [ ] New rate-limitable route has a documented limit
- [ ] Replayable operation accepts `Idempotency-Key`
- [ ] Concurrently editable resource requires `If-Match`

**Threat considered:**

<!-- Which STRIDE category, which OWASP item, and the negative test that proves
     it is handled. "None" is a valid answer when justified. -->

---

## Negative tests

**Listing only happy-path tests is not sufficient for anything touching
security.** What does this reject, and which test proves it?

| Attempt | Expected | Test |
|---|---|---|
| | | |

---

## Database

- Migration: `prisma/migrations/____`
- [ ] Expand/contract used for any destructive or incompatible change
- [ ] `CREATE INDEX CONCURRENTLY` on any large table
- [ ] Rollback documented, or irreversibility explicitly accepted
- [ ] `EXPLAIN ANALYZE` shows no `Seq Scan` on a tenant table

<details>
<summary>Query plans</summary>

```
paste here
```
</details>

---

## Proof of execution

**Real output. Not "tests pass".**

```
$ npm run lint
$ npm run typecheck
$ npm test
$ npm run test:integration
$ npm run test:e2e
$ npm run build
```

<details>
<summary>Output</summary>

```
paste here
```
</details>

---

## Limitations

<!-- Anything incomplete, unverifiable, or deliberately deferred.
     An empty section on a non-trivial PR is usually a missing section. -->

## Next step

<!-- One next step, consistent with IMPLEMENTATION_ROADMAP.md. -->
