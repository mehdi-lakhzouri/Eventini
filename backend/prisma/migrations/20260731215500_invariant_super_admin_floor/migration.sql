-- INV-10 — at least one ACTIVE SUPER_ADMIN platform grant always exists.
-- DATABASE_SCHEMA.md §9, sprint-03 EVT-019.
--
-- The other three enforceable invariants (INV-01, INV-04, INV-09) already
-- have triggers. This one had none: it was stated in §9 and enforced nowhere,
-- which is the difference between an invariant and a sentence.
--
-- ## Why it matters more than it looks
--
-- Losing the last platform administrator is not a data-quality problem, it is
-- a lockout. Nobody can grant the role back, because granting it requires
-- holding it. The recovery is a manual database intervention on production —
-- exactly the situation every other control in this schema exists to avoid.
--
-- ## Why AFTER STATEMENT with a transition table
--
-- Two properties are needed and neither is available to a row-level trigger.
--
-- 1. A virgin database has zero SUPER_ADMIN grants, and that is legal: the
--    invariant forbids going from "at least one" to "none", not being empty.
--    A trigger that simply counted would refuse the very first INSERT of the
--    bootstrap procedure. `REFERENCING OLD TABLE` gives the pre-image, so the
--    check only runs when the statement actually removed an active grant.
--
-- 2. A statement revoking several grants at once must be judged on its final
--    state. A row-level trigger fires between rows, on a table that is
--    half-updated, and would have to reason about an intermediate state that
--    no transaction ever observes.
--
-- Both `UPDATE` and `DELETE` are covered. `platform_role_assignments` is
-- REVOKE_NOT_DELETE, so `UPDATE` is the path anyone is supposed to take and
-- `DELETE` is the path someone takes when they are in a hurry.
CREATE OR REPLACE FUNCTION "enforce_super_admin_floor"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
DECLARE
  removed_active_super_admin BOOLEAN;
  remaining                  INTEGER;
BEGIN
  -- Did this statement touch a grant that was an ACTIVE SUPER_ADMIN before it
  -- ran? If not, the invariant cannot have been broken by it, and a database
  -- with no SUPER_ADMIN at all stays writable.
  SELECT EXISTS (
    SELECT 1
      FROM "removed" r
      JOIN "roles" ro ON ro."id" = r."role_id"
     WHERE r."status" = 'ACTIVE'
       AND ro."code" = 'SUPER_ADMIN'
  ) INTO removed_active_super_admin;

  IF NOT removed_active_super_admin THEN
    RETURN NULL;
  END IF;

  SELECT count(*)
    INTO remaining
    FROM "platform_role_assignments" pra
    JOIN "roles" ro ON ro."id" = pra."role_id"
   WHERE pra."status" = 'ACTIVE'
     AND ro."code" = 'SUPER_ADMIN';

  IF remaining = 0 THEN
    RAISE EXCEPTION
      'INV-10: at least one ACTIVE SUPER_ADMIN platform role assignment must remain; grant another before revoking the last one'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$;

CREATE TRIGGER "trg_super_admin_floor_update"
  AFTER UPDATE ON "platform_role_assignments"
  REFERENCING OLD TABLE AS "removed"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "enforce_super_admin_floor"();

-- A separate trigger rather than `AFTER UPDATE OR DELETE`: PostgreSQL does
-- not allow one statement-level trigger to declare a transition table for
-- several events, because OLD means different things to each.
CREATE TRIGGER "trg_super_admin_floor_delete"
  AFTER DELETE ON "platform_role_assignments"
  REFERENCING OLD TABLE AS "removed"
  FOR EACH STATEMENT
  EXECUTE FUNCTION "enforce_super_admin_floor"();
