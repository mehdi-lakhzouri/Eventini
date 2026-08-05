-- Migration 13 — idempotency_records.
-- DATABASE_SCHEMA.md §8.3, ADR-0012. Sprint-05 EVT-031.

CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "actor_session_id" TEXT,
    "method" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "response_ref" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "locked_until" TIMESTAMPTZ(3),

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_idempotency_records_status" CHECK (
      "status" IN ('PENDING', 'COMPLETED', 'FAILED_RETRYABLE', 'FAILED_FINAL', 'EXPIRED')
    )
);

-- The reservation mechanism itself, not merely an index.
--
-- ADR-0012 answers Document C §19.6's "a simple find-then-insert is
-- vulnerable" by removing the find: the claim is an INSERT ... ON CONFLICT DO
-- NOTHING against this index, so two concurrent requests carrying the same
-- key contend inside PostgreSQL, where exactly one wins.
--
-- The scope includes organization_id AND actor_id (Document C §19.5): the
-- same key in two organizations is two intentions, and a shared key namespace
-- across tenants would also be a cross-tenant channel.
CREATE UNIQUE INDEX "ux_idempotency_scope"
  ON "idempotency_records"("organization_id", "actor_id", "method", "route", "idempotency_key");

-- The rows ux_idempotency_scope cannot constrain, and why they exist.
--
-- NULLs are distinct in a B-tree unique index, so two platform rows — those
-- with organization_id IS NULL, which API_CONVENTIONS.md §8 requires for
-- POST /platform/organizations — would BOTH insert under the index above.
-- The scope declared in DATABASE_SCHEMA.md §8.3 is reproduced verbatim and is
-- correct for tenant rows; this partial index is additive and covers the case
-- that column's nullability creates. Without it the platform path would look
-- protected and silently double-execute.
CREATE UNIQUE INDEX "ux_idempotency_scope_platform"
  ON "idempotency_records"("actor_id", "method", "route", "idempotency_key")
  WHERE "organization_id" IS NULL;

CREATE INDEX "ix_idempotency_expires" ON "idempotency_records"("expires_at");
CREATE INDEX "ix_idempotency_status_created" ON "idempotency_records"("status", "created_at");

ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_actor_session_id_fkey"
  FOREIGN KEY ("actor_session_id") REFERENCES "user_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Immutability of the scope columns, and deletion reserved to retention.
--
-- The table is not APPEND_ONLY — status, the memorised response and the lock
-- all move as the state machine runs. What must not move is the tuple the
-- unique index is built on: rewriting it would hand one intention's memorised
-- answer to a different one, which is worse than having no memory at all.
--
-- request_hash is deliberately NOT in that list. An expired key is "treated
-- as a first request" (§5), and a first request may legitimately carry a
-- different body; since deletion is reserved to retention, the expired row is
-- reused and its fingerprint is what changes. The application-side guard for
-- that is the compare-and-swap in `reclaim`, which only ever fires on a row
-- that is expired, failed, or whose in-flight lock has lapsed.
--
-- DELETE is the same argument in stronger form. The entire guarantee of
-- ADR-0012 is that the row outlives the request — a deleted row is a check-in
-- that can be recorded twice, which is the one failure this table exists to
-- prevent. Retention purge is the only legitimate deletion, so it announces
-- itself with the transaction-scoped flag the other retention-governed tables
-- already use (migrations 8 and 20260801150000). SET LOCAL cannot leak onto
-- another statement on a pooled connection, and has to be set deliberately.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "reject_idempotency_rewrite"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('eventini.retention_purge', true), 'off') <> 'on' THEN
      RAISE EXCEPTION
        'RETENTION_ONLY: idempotency_records rows cannot be deleted outside a retention purge'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN OLD;
  END IF;

  IF NEW."organization_id" IS DISTINCT FROM OLD."organization_id"
     OR NEW."actor_id" <> OLD."actor_id"
     OR NEW."method" <> OLD."method"
     OR NEW."route" <> OLD."route"
     OR NEW."idempotency_key" <> OLD."idempotency_key"
     OR NEW."created_at" <> OLD."created_at" THEN
    RAISE EXCEPTION
      'IMMUTABLE: idempotency_records scope columns cannot be rewritten'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_idempotency_records_immutable"
  BEFORE UPDATE OR DELETE ON "idempotency_records"
  FOR EACH ROW EXECUTE FUNCTION "reject_idempotency_rewrite"();
