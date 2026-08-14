-- CreateTable
CREATE TABLE "roles" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "membership_role_assignments" (
    "id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "membership_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_role_assignments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ux_roles_code" ON "roles"("code");

-- CreateIndex
CREATE INDEX "ix_roles_scope" ON "roles"("scope");

-- CreateIndex
CREATE INDEX "ix_roles_system" ON "roles"("is_system");

-- CreateIndex
CREATE UNIQUE INDEX "ux_permissions_code" ON "permissions"("code");

-- CreateIndex
CREATE INDEX "ix_permissions_resource_action" ON "permissions"("resource", "action");

-- CreateIndex
CREATE INDEX "ix_role_permissions_permission" ON "role_permissions"("permission_id", "role_id");

-- CreateIndex
CREATE INDEX "ix_membership_roles_membership" ON "membership_role_assignments"("membership_id", "revoked_at");

-- CreateIndex
CREATE INDEX "ix_membership_roles_role" ON "membership_role_assignments"("role_id", "revoked_at");

-- CreateIndex
CREATE INDEX "ix_platform_roles_user_status" ON "platform_role_assignments"("user_id", "status");

-- CreateIndex
CREATE INDEX "ix_platform_roles_role_status" ON "platform_role_assignments"("role_id", "status");

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role_assignments" ADD CONSTRAINT "membership_role_assignments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "membership_role_assignments" ADD CONSTRAINT "membership_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_role_assignments" ADD CONSTRAINT "platform_role_assignments_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written additions — sprint-03 EVT-014.
-- ===========================================================================

-- --- CHECK constraints replacing native enums (§2.2) -----------------------

ALTER TABLE "roles"
  ADD CONSTRAINT "ck_roles_scope"
  CHECK ("scope" IN ('PLATFORM', 'ORGANIZATION', 'EVENT'));

ALTER TABLE "platform_role_assignments"
  ADD CONSTRAINT "ck_platform_role_assignments_status"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'REVOKED'));

-- --- Partial unique indexes on REVOKE_NOT_DELETE tables (§2.5) -------------
--
-- `WHERE revoked_at IS NULL` rather than a plain unique index: these rows are
-- never deleted, only revoked, so without the predicate a role could be
-- granted to a membership exactly once in the lifetime of that membership —
-- re-granting after a revocation would collide with the revoked row.

CREATE UNIQUE INDEX "ux_membership_role_active"
  ON "membership_role_assignments" ("membership_id", "role_id")
  WHERE "revoked_at" IS NULL;

CREATE UNIQUE INDEX "ux_platform_role_user_active"
  ON "platform_role_assignments" ("user_id", "role_id")
  WHERE "revoked_at" IS NULL;

-- --- INV-09: role scope is enforced by the database ------------------------
--
-- A PLATFORM-scoped role granted through membership_role_assignments would
-- give platform-wide authority to anyone who can administer a single
-- organization. That is the most direct privilege-escalation path in the
-- whole model, so DATABASE_SCHEMA.md §5.6 requires it be blocked by a trigger
-- as well as in application code: an invariant that only application code
-- upholds is a convention, not an invariant, and it survives exactly until
-- the first script, migration or console session that bypasses the service
-- layer.
--
-- The mirror-image rule is enforced too: platform_role_assignments accepts
-- ONLY PLATFORM-scoped roles, so an ORGANIZATION or EVENT role cannot be
-- quietly widened by inserting it there instead.

CREATE OR REPLACE FUNCTION "enforce_membership_role_scope"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
DECLARE
  role_scope TEXT;
BEGIN
  SELECT "scope" INTO role_scope FROM "roles" WHERE "id" = NEW."role_id";

  IF role_scope IS NULL THEN
    RAISE EXCEPTION 'INV-09: role % does not exist', NEW."role_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF role_scope <> 'ORGANIZATION' THEN
    RAISE EXCEPTION
      'INV-09: membership_role_assignments accepts ORGANIZATION-scoped roles only, got % for role %',
      role_scope, NEW."role_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_membership_role_scope"
  BEFORE INSERT OR UPDATE OF "role_id" ON "membership_role_assignments"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_membership_role_scope"();

CREATE OR REPLACE FUNCTION "enforce_platform_role_scope"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
DECLARE
  role_scope TEXT;
BEGIN
  SELECT "scope" INTO role_scope FROM "roles" WHERE "id" = NEW."role_id";

  IF role_scope IS NULL THEN
    RAISE EXCEPTION 'INV-09: role % does not exist', NEW."role_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF role_scope <> 'PLATFORM' THEN
    RAISE EXCEPTION
      'INV-09: platform_role_assignments accepts PLATFORM-scoped roles only, got % for role %',
      role_scope, NEW."role_id"
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_platform_role_scope"
  BEFORE INSERT OR UPDATE OF "role_id" ON "platform_role_assignments"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_platform_role_scope"();
