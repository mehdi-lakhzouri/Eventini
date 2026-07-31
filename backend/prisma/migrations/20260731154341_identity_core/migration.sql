-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "primary_email" TEXT NOT NULL,
    "normalized_email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "display_name" TEXT,
    "status" TEXT NOT NULL,
    "email_verified_at" TIMESTAMPTZ(3),
    "last_login_at" TIMESTAMPTZ(3),
    "locale" TEXT,
    "timezone" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_credentials" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "password_changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "password_version" INTEGER NOT NULL DEFAULT 1,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "license_plan" TEXT NOT NULL,
    "user_limit" INTEGER,
    "event_limit" INTEGER,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_memberships" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "joined_at" TIMESTAMPTZ(3),
    "invited_by" TEXT,
    "activated_at" TIMESTAMPTZ(3),
    "activated_by" TEXT,
    "suspended_at" TIMESTAMPTZ(3),
    "suspended_by" TEXT,
    "suspension_reason" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "revocation_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,

    CONSTRAINT "organization_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_users_status" ON "users"("status");

-- CreateIndex
CREATE INDEX "ix_users_created_at" ON "users"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "user_credentials_user_id_key" ON "user_credentials"("user_id");

-- CreateIndex
CREATE INDEX "ix_organizations_status" ON "organizations"("status");

-- CreateIndex
CREATE INDEX "ix_organizations_is_enabled" ON "organizations"("is_enabled");

-- CreateIndex
CREATE INDEX "ix_memberships_org_status" ON "organization_memberships"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ix_memberships_user_status" ON "organization_memberships"("user_id", "status");

-- CreateIndex
CREATE INDEX "ix_memberships_org_created" ON "organization_memberships"("organization_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "user_credentials" ADD CONSTRAINT "user_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_memberships" ADD CONSTRAINT "organization_memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written additions — sprint-03 EVT-014.
--
-- Everything below is something Prisma's schema language cannot express, so
-- it is appended here rather than generated. Each block names the section of
-- docs/database/DATABASE_SCHEMA.md it implements.
-- ===========================================================================

-- --- CHECK constraints replacing native enums (§2.2) -----------------------
--
-- TEXT + CHECK rather than CREATE TYPE ... AS ENUM: a value can be added to a
-- native PostgreSQL enum but removing one requires rewriting the table, while
-- a CHECK is altered by an ordinary migration. The permitted values are
-- declared once in src/infrastructure/database/enums.ts, and a spec asserts
-- these lists match it so the two cannot drift.

ALTER TABLE "users"
  ADD CONSTRAINT "ck_users_status"
  CHECK ("status" IN ('PENDING', 'ACTIVE', 'LOCKED', 'SUSPENDED', 'DEACTIVATED', 'DELETED'));

ALTER TABLE "organizations"
  ADD CONSTRAINT "ck_organizations_status"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'KILLED', 'DELETED'));

ALTER TABLE "organization_memberships"
  ADD CONSTRAINT "ck_memberships_status"
  CHECK ("status" IN ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'EXPIRED', 'DELETED'));

-- --- Partial unique indexes on soft-deleted tables (§2.5) ------------------
--
-- `WHERE deleted_at IS NULL` is the whole point: a plain unique index would
-- let a soft-deleted row reserve its email or slug permanently, so an address
-- could never be reused after the account holding it was deleted. Prisma
-- cannot express a partial index, which is why these are here and absent from
-- schema.prisma.

CREATE UNIQUE INDEX "ux_users_normalized_email_active"
  ON "users" ("normalized_email")
  WHERE "deleted_at" IS NULL;

CREATE UNIQUE INDEX "ux_organizations_slug_active"
  ON "organizations" ("slug")
  WHERE "deleted_at" IS NULL;

-- At most one live membership per (user, organization). Partial for the same
-- reason: re-inviting a user whose membership was soft-deleted must work.
CREATE UNIQUE INDEX "ux_membership_user_org_active"
  ON "organization_memberships" ("user_id", "organization_id")
  WHERE "deleted_at" IS NULL;

-- --- Partial index on a nullable column (§10) ------------------------------
--
-- Only rows that have actually logged in are indexed, which keeps the index
-- proportional to active users rather than to every account ever created.
CREATE INDEX "ix_users_last_login_at"
  ON "users" ("last_login_at" DESC)
  WHERE "last_login_at" IS NOT NULL;
