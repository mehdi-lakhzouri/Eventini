-- CreateTable
CREATE TABLE "security_events" (
    "id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "reason_code" TEXT,
    "user_id" TEXT,
    "session_id" TEXT,
    "organization_id" TEXT,
    "membership_id" TEXT,
    "device_id" TEXT,
    "request_id" TEXT,
    "trace_id" TEXT,
    "ip_address" INET,
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_session_id" TEXT,
    "actor_role" TEXT,
    "organization_id" TEXT,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "action" TEXT NOT NULL,
    "previous_values" JSONB,
    "new_values" JSONB,
    "reason" TEXT,
    "request_id" TEXT,
    "ip_address" INET,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_security_events_type_time" ON "security_events"("event_type", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_security_events_severity_time" ON "security_events"("severity", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_org_time" ON "audit_logs"("organization_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_actor_time" ON "audit_logs"("actor_user_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_target" ON "audit_logs"("target_type", "target_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "ix_audit_action_time" ON "audit_logs"("action", "occurred_at" DESC);

-- ===========================================================================
-- Hand-written additions — sprint-03 EVT-016.
-- ===========================================================================

-- --- CHECK constraints replacing native enums (§2.2) -----------------------
--
-- The event_type list is the union of the corpus's four competing catalogues
-- (contradiction C-11), per AUTHENTICATION_AUTHORIZATION.md §8. Document D
-- required recording types the narrowest of those enums could not store, so
-- a partial list here would silently drop exactly the events that matter.

ALTER TABLE "security_events"
  ADD CONSTRAINT "ck_security_events_type"
  CHECK ("event_type" IN (
    'LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'ACCOUNT_LOCKED',
    'MFA_CHALLENGE_CREATED', 'MFA_SUCCEEDED', 'MFA_FAILED', 'MFA_ENABLED', 'MFA_DISABLED',
    'SESSION_CREATED', 'SESSION_REFRESHED', 'SESSION_REVOKED', 'ALL_SESSIONS_REVOKED',
    'SESSION_COMPROMISED', 'REFRESH_TOKEN_REUSE_DETECTED',
    'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED', 'PASSWORD_RESET_COMPLETED',
    'ROLE_CHANGED', 'ROLE_ESCALATION_ATTEMPTED', 'MEMBERSHIP_REVOKED',
    'TENANT_ACCESS_DENIED', 'REAUTHENTICATION_REQUIRED',
    'CSRF_VALIDATION_FAILED', 'ORIGIN_VALIDATION_FAILED', 'RATE_LIMIT_EXCEEDED',
    'ORGANIZATION_SUSPENDED', 'ORGANIZATION_KILL_SWITCH_EXECUTED',
    'ORGANIZATION_CONTEXT_SWITCHED',
    'TICKET_SIGNATURE_INVALID', 'TICKET_REPLAY_DETECTED', 'SCANNER_DEVICE_REVOKED',
    'IDEMPOTENCY_CONFLICT_DETECTED', 'UNSCOPED_QUERY_EXECUTED', 'SIGNING_KEY_ROTATED'
  ));

ALTER TABLE "security_events"
  ADD CONSTRAINT "ck_security_events_severity"
  CHECK ("severity" IN ('INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'));

-- DENIED is distinct from FAILURE on purpose: a failure is an attempt that
-- did not work, a denial is one refused by policy. Collapsing them makes
-- "how many people were blocked by authorization" unanswerable.
ALTER TABLE "security_events"
  ADD CONSTRAINT "ck_security_events_result"
  CHECK ("result" IN ('SUCCESS', 'FAILURE', 'DENIED'));

-- --- Partial indexes (§8.1, §8.2) ------------------------------------------
--
-- Every actor column on security_events is nullable, because an event can
-- precede identity entirely — a failed login has no user, an origin rejection
-- no session. Partial indexes keep each one proportional to the rows that
-- actually carry the column rather than to the whole table.

CREATE INDEX "ix_security_events_user_time"
  ON "security_events" ("user_id", "occurred_at" DESC)
  WHERE "user_id" IS NOT NULL;

CREATE INDEX "ix_security_events_org_time"
  ON "security_events" ("organization_id", "occurred_at" DESC)
  WHERE "organization_id" IS NOT NULL;

CREATE INDEX "ix_security_events_request"
  ON "security_events" ("request_id")
  WHERE "request_id" IS NOT NULL;

CREATE INDEX "ix_audit_request"
  ON "audit_logs" ("request_id")
  WHERE "request_id" IS NOT NULL;

-- --- APPEND_ONLY, enforced by the database (§2.5) --------------------------
--
-- The ticket's rule is "no UPDATE, no DELETE from the application". Leaving
-- that to convention would defeat the purpose of the tables: an audit trail
-- an application can rewrite is not evidence of anything, and the first
-- person to need it rewritten is whoever the trail incriminates. Enforcing it
-- here means a stray `UPDATE`, an ORM misuse, a migration or a console
-- session all fail identically.
--
-- ## The retention escape, and why it is a session flag
--
-- security_events is retained for 12 months (§8.1), so deletion has to be
-- possible for the purge and impossible for everything else. The escape is a
-- transaction-local setting rather than a separate database role, because a
-- role would have to be granted somewhere and could then be used by anything
-- holding those credentials; `SET LOCAL` cannot outlive its transaction and
-- cannot be set accidentally — the purge job states its intent in the same
-- transaction as the delete, and nothing else ever names the flag.
--
-- `current_setting(..., true)` returns NULL rather than raising when the
-- setting is unset, which is what makes the ordinary case a cheap NULL check.

CREATE OR REPLACE FUNCTION "reject_audit_mutation"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION
      'APPEND_ONLY: % rows cannot be updated; record a compensating entry instead',
      TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  -- DELETE: allowed only inside a transaction that has declared itself a
  -- retention purge.
  IF coalesce(current_setting('eventini.retention_purge', true), 'off') <> 'on' THEN
    RAISE EXCEPTION
      'APPEND_ONLY: % rows cannot be deleted outside a retention purge',
      TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$$;

CREATE TRIGGER "trg_security_events_append_only"
  BEFORE UPDATE OR DELETE ON "security_events"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_audit_mutation"();

CREATE TRIGGER "trg_audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_audit_mutation"();
