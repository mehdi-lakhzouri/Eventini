-- CreateTable
CREATE TABLE "participants" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "normalized_email" TEXT,
    "phone" TEXT,
    "participant_type" TEXT NOT NULL,
    "organization_name" TEXT,
    "job_title" TEXT,
    "country" TEXT,
    "external_reference" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "dedup_fingerprint" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_participants_org_dedup" ON "participants"("organization_id", "dedup_fingerprint");

-- CreateIndex
CREATE INDEX "ix_participants_org_type" ON "participants"("organization_id", "participant_type");

-- CreateIndex
CREATE INDEX "ix_participants_org_created" ON "participants"("organization_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "ix_participants_org_lastname" ON "participants"("organization_id", "last_name");

-- AddForeignKey
ALTER TABLE "participants" ADD CONSTRAINT "participants_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written additions — sprint-10 EVT-054.
--
-- Everything below is beyond what Prisma's schema language can express. Each
-- block names the section of docs/database/DATABASE_SCHEMA.md it implements.
-- ===========================================================================

-- --- CHECK constraints replacing native enums (§2.2, §7.1) -----------------

ALTER TABLE "participants"
  ADD CONSTRAINT "ck_participants_type"
  CHECK ("participant_type" IN ('STANDARD', 'TRAVEL_GRANT', 'AMBASSADOR', 'SPEAKER', 'STAFF', 'VIP'));

-- --- Partial index (§7.1) ---------------------------------------------------
--
-- Unicity of email is per organization, never global: the same person can be
-- a participant for two different clients, and those are two unrelated rows —
-- an isolation requirement, not a limitation (§7.1). Partial on both
-- normalized_email (a participant may have none — walk-in registration, minor
-- attendee) and deleted_at (SOFT_DELETE, §2.5): without the second predicate a
-- removed participant would permanently block reusing their email address.

CREATE UNIQUE INDEX "ux_participants_org_email_active"
  ON "participants" ("organization_id", "normalized_email")
  WHERE "normalized_email" IS NOT NULL AND "deleted_at" IS NULL;
