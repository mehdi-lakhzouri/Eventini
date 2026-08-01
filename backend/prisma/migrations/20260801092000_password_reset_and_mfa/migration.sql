-- Migration 6 — password_reset_tokens, mfa_methods, mfa_recovery_codes.
-- DATABASE_SCHEMA.md §4.5, §4.7, §4.8. Sprint-04 EVT-021.

CREATE TABLE "password_reset_tokens" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "requested_ip" INET,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_password_reset_tokens_status" CHECK (
      "status" IN ('PENDING', 'USED', 'EXPIRED', 'REVOKED', 'REPLACED')
    )
);

CREATE UNIQUE INDEX "ux_password_reset_token_hash" ON "password_reset_tokens"("token_hash");
CREATE INDEX "ix_password_reset_user_status" ON "password_reset_tokens"("user_id", "status");
CREATE INDEX "ix_password_reset_expires" ON "password_reset_tokens"("expires_at") WHERE "status" = 'PENDING';

ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mfa_methods" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "encrypted_secret" TEXT NOT NULL,
    "verified_at" TIMESTAMPTZ(3),
    "enabled_at" TIMESTAMPTZ(3),
    "disabled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "mfa_methods_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ck_mfa_methods_type" CHECK ("type" IN ('TOTP')),
    CONSTRAINT "ck_mfa_methods_status" CHECK (
      "status" IN ('PENDING', 'ACTIVE', 'DISABLED', 'COMPROMISED')
    )
);

CREATE INDEX "ix_mfa_user_status" ON "mfa_methods"("user_id", "status");

-- C-28: Document A's single index covered PENDING and ACTIVE together, which
-- made re-enrolment impossible while a method was active. Split, a PENDING
-- method can coexist with an ACTIVE one, which is exactly a device swap.
CREATE UNIQUE INDEX "ux_mfa_user_type_pending" ON "mfa_methods"("user_id", "type") WHERE "status" = 'PENDING';
CREATE UNIQUE INDEX "ux_mfa_user_type_active" ON "mfa_methods"("user_id", "type") WHERE "status" = 'ACTIVE';

ALTER TABLE "mfa_methods" ADD CONSTRAINT "mfa_methods_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "mfa_recovery_codes" (
    "id" TEXT NOT NULL,
    "mfa_method_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_mfa_recovery_code_hash" ON "mfa_recovery_codes"("code_hash");
CREATE INDEX "ix_mfa_recovery_method_available" ON "mfa_recovery_codes"("mfa_method_id", "used_at", "revoked_at");

ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_mfa_method_id_fkey" FOREIGN KEY ("mfa_method_id") REFERENCES "mfa_methods"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- INV-11 — a user carrying SUPER_ADMIN has an ACTIVE MFA method.
--
-- Enforced only once the user itself is ACTIVE, and that qualification is
-- derived rather than quoted. §9 states the invariant unconditionally, but
-- MIGRATION_STRATEGY.md §8.2's bootstrap procedure creates the platform
-- administrator PENDING, with the grant already in place and no MFA, and
-- moves it to ACTIVE only after enrolment succeeds. Enforcing it
-- unconditionally would make that documented procedure impossible.
--
-- The qualification costs nothing: a PENDING user cannot authenticate, so it
-- cannot use the grant either. What matters is that nobody can *use*
-- SUPER_ADMIN without MFA.
--
-- Two triggers, because there are two ways in: grant the role to an active
-- user, or activate a user who already holds it. Guarding only the first
-- leaves the second as a two-step bypass.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "user_has_active_mfa"(target_user TEXT)
  RETURNS BOOLEAN
  LANGUAGE sql
  STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM "mfa_methods"
     WHERE "user_id" = target_user AND "status" = 'ACTIVE'
  );
$$;

CREATE OR REPLACE FUNCTION "enforce_super_admin_mfa_on_grant"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
DECLARE
  role_code   TEXT;
  user_status TEXT;
BEGIN
  IF NEW."status" <> 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  SELECT "code" INTO role_code FROM "roles" WHERE "id" = NEW."role_id";

  IF role_code IS DISTINCT FROM 'SUPER_ADMIN' THEN
    RETURN NEW;
  END IF;

  SELECT "status" INTO user_status FROM "users" WHERE "id" = NEW."user_id";

  IF user_status = 'ACTIVE' AND NOT "user_has_active_mfa"(NEW."user_id") THEN
    RAISE EXCEPTION
      'INV-11: user % must have an ACTIVE MFA method before holding SUPER_ADMIN',
      NEW."user_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_super_admin_mfa_on_grant"
  BEFORE INSERT OR UPDATE OF "role_id", "status", "user_id"
  ON "platform_role_assignments"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_super_admin_mfa_on_grant"();

CREATE OR REPLACE FUNCTION "enforce_super_admin_mfa_on_activation"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" <> 'ACTIVE' OR OLD."status" = 'ACTIVE' THEN
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM "platform_role_assignments" pra
      JOIN "roles" r ON r."id" = pra."role_id"
     WHERE pra."user_id" = NEW."id"
       AND pra."status" = 'ACTIVE'
       AND r."code" = 'SUPER_ADMIN'
  ) AND NOT "user_has_active_mfa"(NEW."id") THEN
    RAISE EXCEPTION
      'INV-11: user % holds SUPER_ADMIN and cannot be activated without an ACTIVE MFA method',
      NEW."id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_super_admin_mfa_on_activation"
  BEFORE UPDATE OF "status" ON "users"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_super_admin_mfa_on_activation"();
