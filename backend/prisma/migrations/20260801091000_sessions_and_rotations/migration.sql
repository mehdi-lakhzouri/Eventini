-- Migration 5 — user_sessions and refresh_token_rotations.
-- DATABASE_SCHEMA.md §4.3, §4.4. Sprint-04 EVT-021.

CREATE TABLE "user_sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT,
    "active_membership_id" TEXT,
    "token_family_id" TEXT NOT NULL,
    "client_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "device_id" TEXT,
    "device_name" TEXT,
    "user_agent" TEXT,
    "ip_address" INET,
    "authentication_level" TEXT NOT NULL,
    "mfa_verified_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idle_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "absolute_expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "created_by_request_id" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_sessions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_sessions_client_type" CHECK ("client_type" IN ('WEB', 'MOBILE_SCANNER')),
    CONSTRAINT "ck_sessions_status" CHECK (
      "status" IN ('ACTIVE', 'REVOKED', 'EXPIRED', 'COMPROMISED', 'REPLACED')
    ),
    CONSTRAINT "ck_sessions_authentication_level" CHECK (
      "authentication_level" IN ('PASSWORD', 'MFA', 'REAUTHENTICATED')
    ),

    -- INV-12, resolving C-29: Document A made both columns nullable and called
    -- them "coherent" without ever defining the platform case.
    CONSTRAINT "ck_sessions_tenant_coherence" CHECK (
      ("organization_id" IS NULL     AND "active_membership_id" IS NULL) OR
      ("organization_id" IS NOT NULL AND "active_membership_id" IS NOT NULL)
    ),

    -- A session that idles out after it has already expired absolutely is a
    -- session whose absolute bound means nothing.
    CONSTRAINT "ck_sessions_expiry_order" CHECK ("idle_expires_at" <= "absolute_expires_at")
);

CREATE INDEX "ix_sessions_user_status" ON "user_sessions"("user_id", "status");
CREATE INDEX "ix_sessions_membership_status" ON "user_sessions"("active_membership_id", "status");
CREATE INDEX "ix_sessions_org_status" ON "user_sessions"("organization_id", "status");
CREATE INDEX "ix_sessions_family" ON "user_sessions"("token_family_id");
CREATE INDEX "ix_sessions_idle_expiry" ON "user_sessions"("idle_expires_at") WHERE "status" = 'ACTIVE';
CREATE INDEX "ix_sessions_absolute_expiry" ON "user_sessions"("absolute_expires_at") WHERE "status" = 'ACTIVE';
CREATE INDEX "ix_sessions_device_status" ON "user_sessions"("device_id", "status") WHERE "device_id" IS NOT NULL;

ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_active_membership_id_fkey" FOREIGN KEY ("active_membership_id") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- INV-02 — the session's user and organization must be the membership's.
-- Without it, a session could name membership X while claiming to belong to
-- another user or another tenant, and every authorization decision downstream
-- reads those columns.
CREATE OR REPLACE FUNCTION "enforce_session_membership_coherence"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
DECLARE
  membership_user TEXT;
  membership_org  TEXT;
BEGIN
  IF NEW."active_membership_id" IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT "user_id", "organization_id" INTO membership_user, membership_org
    FROM "organization_memberships" WHERE "id" = NEW."active_membership_id";

  IF membership_user IS NULL THEN
    RAISE EXCEPTION 'INV-02: membership % does not exist', NEW."active_membership_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF membership_user <> NEW."user_id" THEN
    RAISE EXCEPTION
      'INV-02: session user_id (%) must equal organization_memberships.user_id (%)',
      NEW."user_id", membership_user
      USING ERRCODE = 'check_violation';
  END IF;

  IF membership_org IS DISTINCT FROM NEW."organization_id" THEN
    RAISE EXCEPTION
      'INV-02: session organization_id (%) must equal organization_memberships.organization_id (%)',
      NEW."organization_id", membership_org
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_session_membership_coherence"
  BEFORE INSERT OR UPDATE OF "user_id", "organization_id", "active_membership_id"
  ON "user_sessions"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_session_membership_coherence"();

CREATE TABLE "refresh_token_rotations" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "token_family_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "previous_token_id" TEXT,
    "replaced_by_token_id" TEXT,
    "status" TEXT NOT NULL,
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "reuse_detected_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_token_rotations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_refresh_rotations_status" CHECK (
      "status" IN ('ACTIVE', 'CONSUMED', 'REVOKED', 'EXPIRED', 'REUSED')
    )
);

CREATE UNIQUE INDEX "ux_refresh_token_hash" ON "refresh_token_rotations"("token_hash");

-- AUTH-INV-003, resolving C-27. Document A asserted "one ACTIVE token per
-- family" and indexed nothing. This index is what makes two concurrent
-- rotations mutually exclusive: the loser violates it and fails. A Redis lock
-- would coordinate; only this guarantees.
CREATE UNIQUE INDEX "ux_refresh_active_per_family"
  ON "refresh_token_rotations"("token_family_id") WHERE "status" = 'ACTIVE';

CREATE INDEX "ix_refresh_session_status" ON "refresh_token_rotations"("session_id", "status");
CREATE INDEX "ix_refresh_family_status" ON "refresh_token_rotations"("token_family_id", "status");
CREATE INDEX "ix_refresh_expires" ON "refresh_token_rotations"("expires_at") WHERE "status" = 'ACTIVE';
CREATE INDEX "ix_refresh_previous" ON "refresh_token_rotations"("previous_token_id") WHERE "previous_token_id" IS NOT NULL;

ALTER TABLE "refresh_token_rotations" ADD CONSTRAINT "refresh_token_rotations_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "user_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "refresh_token_rotations" ADD CONSTRAINT "refresh_token_rotations_previous_token_id_fkey" FOREIGN KEY ("previous_token_id") REFERENCES "refresh_token_rotations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- APPEND_ONLY (§2.5): the rotation chain is the audit trail of every session.
-- Status transitions are the one permitted update, so DELETE is refused and
-- UPDATE may not rewrite what was issued.
CREATE OR REPLACE FUNCTION "reject_rotation_rewrite"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'APPEND_ONLY: refresh_token_rotations rows cannot be deleted outside a retention purge'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW."token_hash" <> OLD."token_hash"
     OR NEW."session_id" <> OLD."session_id"
     OR NEW."token_family_id" <> OLD."token_family_id"
     OR NEW."issued_at" <> OLD."issued_at" THEN
    RAISE EXCEPTION
      'APPEND_ONLY: refresh_token_rotations identity columns cannot be rewritten'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_rotations_append_only"
  BEFORE UPDATE OR DELETE ON "refresh_token_rotations"
  FOR EACH ROW
  EXECUTE FUNCTION "reject_rotation_rewrite"();
