-- Migration 4 — invitations, email verification, and the tenant column
-- ADR-0003 §1 required on membership_role_assignments.
-- DATABASE_SCHEMA.md §4.6, §5.8. Sprint-04 EVT-021.

-- ---------------------------------------------------------------------------
-- membership_role_assignments.organization_id
--
-- ADR-0003 §1 requires every tenant-owned table to carry the column and
-- forbids transitive joins; §5.6 classified this table ORGANIZATION-OWNED
-- "via le membership" and listed no such column, so EVT-014 built it without
-- one. EVT-018 kept the table guarded by traversing the relation and recorded
-- the fix here.
--
-- Expand, backfill, contract: adding a NOT NULL column outright fails on any
-- database that already has rows, and the point of the sequence is that it
-- does not depend on the table being empty.
-- ---------------------------------------------------------------------------
ALTER TABLE "membership_role_assignments" ADD COLUMN "organization_id" TEXT;

UPDATE "membership_role_assignments" a
   SET "organization_id" = m."organization_id"
  FROM "organization_memberships" m
 WHERE m."id" = a."membership_id"
   AND a."organization_id" IS NULL;

ALTER TABLE "membership_role_assignments"
  ALTER COLUMN "organization_id" SET NOT NULL;

ALTER TABLE "membership_role_assignments"
  ADD CONSTRAINT "membership_role_assignments_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ix_membership_roles_org"
  ON "membership_role_assignments"("organization_id", "revoked_at");

-- The denormalised column is only trustworthy if it cannot disagree with the
-- membership it was copied from — the same reasoning as INV-01.
CREATE OR REPLACE FUNCTION "enforce_membership_role_tenant"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
DECLARE
  membership_org TEXT;
BEGIN
  SELECT "organization_id" INTO membership_org
    FROM "organization_memberships" WHERE "id" = NEW."membership_id";

  IF membership_org IS NULL THEN
    RAISE EXCEPTION 'INV-09: membership % does not exist', NEW."membership_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF membership_org <> NEW."organization_id" THEN
    RAISE EXCEPTION
      'INV-09: assignment organization_id (%) must equal organization_memberships.organization_id (%)',
      NEW."organization_id", membership_org
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_membership_role_tenant"
  BEFORE INSERT OR UPDATE OF "organization_id", "membership_id"
  ON "membership_role_assignments"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_membership_role_tenant"();

-- ---------------------------------------------------------------------------
-- user_invitations
-- ---------------------------------------------------------------------------
CREATE TABLE "user_invitations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "invited_user_id" TEXT,
    "membership_id" TEXT,
    "role_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_invitations_status" CHECK (
      "status" IN ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED', 'REPLACED')
    )
);

CREATE UNIQUE INDEX "ux_invitation_token_hash" ON "user_invitations"("token_hash");
CREATE INDEX "ix_invitations_org_status" ON "user_invitations"("organization_id", "status");
CREATE INDEX "ix_invitations_email_status" ON "user_invitations"("normalized_email", "status");
CREATE INDEX "ix_invitations_expires" ON "user_invitations"("expires_at") WHERE "status" = 'PENDING';

ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_invited_user_id_fkey" FOREIGN KEY ("invited_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "user_invitations" ADD CONSTRAINT "user_invitations_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- email_verification_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE "email_verification_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_verification_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_email_verification_tokens_status" CHECK (
      "status" IN ('PENDING', 'VERIFIED', 'EXPIRED', 'REVOKED', 'REPLACED')
    )
);

CREATE UNIQUE INDEX "ux_email_verification_token_hash" ON "email_verification_tokens"("token_hash");
CREATE INDEX "ix_email_verification_user_status" ON "email_verification_tokens"("user_id", "status");
CREATE INDEX "ix_email_verification_email_status" ON "email_verification_tokens"("normalized_email", "status");
CREATE INDEX "ix_email_verification_expires" ON "email_verification_tokens"("expires_at") WHERE "status" = 'PENDING';

ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
