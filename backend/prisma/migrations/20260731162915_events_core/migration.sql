-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL,
    "event_code" TEXT NOT NULL,
    "timezone" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "check_in_opens_at" TIMESTAMPTZ(3),
    "check_in_closes_at" TIMESTAMPTZ(3),
    "capacity" INTEGER,
    "location_name" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "activated_at" TIMESTAMPTZ(3),
    "activated_by" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" TEXT,
    "cancellation_reason" TEXT,
    "expired_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_sessions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "session_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "check_in_opens_at" TIMESTAMPTZ(3),
    "check_in_closes_at" TIMESTAMPTZ(3),
    "capacity" INTEGER,
    "location_name" TEXT,
    "requires_separate_check_in" BOOLEAN NOT NULL DEFAULT true,
    "opened_at" TIMESTAMPTZ(3),
    "opened_by" TEXT,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by" TEXT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_by" TEXT,
    "deleted_at" TIMESTAMPTZ(3),
    "deleted_by" TEXT,
    "deletion_reason" TEXT,

    CONSTRAINT "event_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_user_assignments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "membership_id" TEXT NOT NULL,
    "assignment_type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "valid_from" TIMESTAMPTZ(3),
    "valid_until" TIMESTAMPTZ(3),
    "assigned_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assigned_by" TEXT,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "event_user_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_events_org_status" ON "events"("organization_id", "status");

-- CreateIndex
CREATE INDEX "ix_events_org_starts_at" ON "events"("organization_id", "starts_at" DESC);

-- CreateIndex
CREATE INDEX "ix_events_status_check_in" ON "events"("status", "check_in_opens_at", "check_in_closes_at");

-- CreateIndex
CREATE INDEX "ix_event_sessions_org_event" ON "event_sessions"("organization_id", "event_id");

-- CreateIndex
CREATE INDEX "ix_event_sessions_event_status" ON "event_sessions"("event_id", "status");

-- CreateIndex
CREATE INDEX "ix_event_sessions_event_starts" ON "event_sessions"("event_id", "starts_at");

-- CreateIndex
CREATE INDEX "ix_event_assignments_membership" ON "event_user_assignments"("membership_id", "status");

-- CreateIndex
CREATE INDEX "ix_event_assignments_event" ON "event_user_assignments"("event_id", "status");

-- CreateIndex
CREATE INDEX "ix_event_assignments_org_event" ON "event_user_assignments"("organization_id", "event_id");

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_sessions" ADD CONSTRAINT "event_sessions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_user_assignments" ADD CONSTRAINT "event_user_assignments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_user_assignments" ADD CONSTRAINT "event_user_assignments_membership_id_fkey" FOREIGN KEY ("membership_id") REFERENCES "organization_memberships"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ===========================================================================
-- Hand-written additions — sprint-03 EVT-015.
--
-- Everything below is beyond what Prisma's schema language can express. Each
-- block names the section of docs/database/DATABASE_SCHEMA.md it implements.
-- ===========================================================================

-- --- CHECK constraints replacing native enums (§2.2) -----------------------

ALTER TABLE "events"
  ADD CONSTRAINT "ck_events_status"
  CHECK ("status" IN ('DRAFT', 'ACTIVE', 'EXPIRED', 'CANCELLED'));

ALTER TABLE "event_sessions"
  ADD CONSTRAINT "ck_event_sessions_type"
  CHECK ("session_type" IN ('DAY', 'PANEL', 'WORKSHOP', 'ZONE', 'SLOT'));

ALTER TABLE "event_sessions"
  ADD CONSTRAINT "ck_event_sessions_status"
  CHECK ("status" IN ('SCHEDULED', 'OPEN', 'CLOSED'));

ALTER TABLE "event_user_assignments"
  ADD CONSTRAINT "ck_event_assignments_type"
  CHECK ("assignment_type" IN ('EVENT_ADMIN', 'SCANNER', 'REPORT_VIEWER', 'SESSION_MANAGER'));

ALTER TABLE "event_user_assignments"
  ADD CONSTRAINT "ck_event_assignments_status"
  CHECK ("status" IN ('ACTIVE', 'SUSPENDED', 'REVOKED'));

-- --- Temporal coherence (§6.1, §6.2) ---------------------------------------
--
-- An event ending before it starts is not a validation edge case, it is a
-- corrupt row: every check-in window, every report period and every
-- expiry sweep derives from this ordering.

ALTER TABLE "events"
  ADD CONSTRAINT "ck_events_date_order"
  CHECK ("starts_at" < "ends_at");

-- Either bound may be NULL (meaning "follow the event"), so the constraint
-- only bites when both are present.
ALTER TABLE "events"
  ADD CONSTRAINT "ck_events_checkin_window"
  CHECK (
    "check_in_opens_at" IS NULL
    OR "check_in_closes_at" IS NULL
    OR "check_in_opens_at" < "check_in_closes_at"
  );

ALTER TABLE "event_sessions"
  ADD CONSTRAINT "ck_event_sessions_date_order"
  CHECK ("starts_at" < "ends_at");

ALTER TABLE "event_sessions"
  ADD CONSTRAINT "ck_event_sessions_checkin_window"
  CHECK (
    "check_in_opens_at" IS NULL
    OR "check_in_closes_at" IS NULL
    OR "check_in_opens_at" < "check_in_closes_at"
  );

-- Beyond §6.3, which specifies the window's meaning but no constraint. An
-- assignment whose validity ends before it begins grants nothing at any
-- instant, so it can only be a data-entry error; rejecting it costs nothing
-- and stops a silently-inert permission from looking granted in the UI.
ALTER TABLE "event_user_assignments"
  ADD CONSTRAINT "ck_event_assignments_validity_order"
  CHECK (
    "valid_from" IS NULL
    OR "valid_until" IS NULL
    OR "valid_from" < "valid_until"
  );

-- --- Partial indexes (§2.5, §6.1, §6.3) ------------------------------------

-- Slug is unique per organization: two tenants may each run a "summit-2026".
CREATE UNIQUE INDEX "ux_events_org_slug_active"
  ON "events" ("organization_id", "slug")
  WHERE "deleted_at" IS NULL;

-- event_code is unique GLOBALLY, which is not a tenant-first violation but
-- its inverse: a scanner types this code before any tenant is known, so it is
-- the value that resolves the tenant.
CREATE UNIQUE INDEX "ux_events_event_code_active"
  ON "events" ("event_code")
  WHERE "deleted_at" IS NULL;

-- One live assignment per (event, membership, type). Partial on revoked_at
-- because these rows are never deleted: without the predicate, a revoked
-- assignment would block ever re-assigning the same person to the same role
-- on the same event.
CREATE UNIQUE INDEX "ux_event_assignment_active"
  ON "event_user_assignments" ("event_id", "membership_id", "assignment_type")
  WHERE "revoked_at" IS NULL;

-- The hot path for a scanner: "is any session open right now?". Partial, so
-- the index holds only sessions that are actually open rather than every
-- session ever scheduled.
CREATE INDEX "ix_event_sessions_open_window"
  ON "event_sessions" ("status", "check_in_opens_at", "check_in_closes_at")
  WHERE "status" = 'OPEN';

-- --- INV-04: event_sessions.organization_id = events.organization_id -------
--
-- The denormalised organization_id is what lets the tenant-isolation
-- extension (ADR-0003, EVT-018) check scope without a join. That only holds
-- while the copy is true, so the copy is enforced here rather than trusted:
-- a session whose organization_id disagrees with its event would be visible
-- to the wrong tenant by exactly the mechanism meant to prevent it.

CREATE OR REPLACE FUNCTION "enforce_event_session_tenant"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
DECLARE
  event_org TEXT;
BEGIN
  SELECT "organization_id" INTO event_org FROM "events" WHERE "id" = NEW."event_id";

  IF event_org IS NULL THEN
    RAISE EXCEPTION 'INV-04: event % does not exist', NEW."event_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF event_org <> NEW."organization_id" THEN
    RAISE EXCEPTION
      'INV-04: event_sessions.organization_id (%) must equal events.organization_id (%)',
      NEW."organization_id", event_org
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_event_session_tenant"
  BEFORE INSERT OR UPDATE OF "organization_id", "event_id" ON "event_sessions"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_event_session_tenant"();

-- --- INV-01: assignment tenant equals BOTH the event and the membership ----
--
-- Two separate comparisons, and both matter. Matching only the event would
-- let a membership from another organization be assigned to this event;
-- matching only the membership would let this organization's member be
-- assigned to another tenant's event. Either one alone is a cross-tenant
-- grant.

CREATE OR REPLACE FUNCTION "enforce_event_assignment_tenant"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
DECLARE
  event_org      TEXT;
  membership_org TEXT;
BEGIN
  SELECT "organization_id" INTO event_org FROM "events" WHERE "id" = NEW."event_id";
  SELECT "organization_id" INTO membership_org
    FROM "organization_memberships" WHERE "id" = NEW."membership_id";

  IF event_org IS NULL OR membership_org IS NULL THEN
    RAISE EXCEPTION 'INV-01: event % or membership % does not exist',
      NEW."event_id", NEW."membership_id"
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF event_org <> NEW."organization_id" THEN
    RAISE EXCEPTION
      'INV-01: assignment organization_id (%) must equal events.organization_id (%)',
      NEW."organization_id", event_org
      USING ERRCODE = 'check_violation';
  END IF;

  IF membership_org <> NEW."organization_id" THEN
    RAISE EXCEPTION
      'INV-01: assignment organization_id (%) must equal organization_memberships.organization_id (%)',
      NEW."organization_id", membership_org
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "trg_event_assignment_tenant"
  BEFORE INSERT OR UPDATE OF "organization_id", "event_id", "membership_id"
    ON "event_user_assignments"
  FOR EACH ROW
  EXECUTE FUNCTION "enforce_event_assignment_tenant"();
