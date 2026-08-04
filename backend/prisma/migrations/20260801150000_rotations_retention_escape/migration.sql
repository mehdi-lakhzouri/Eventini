-- refresh_token_rotations honours the same retention escape as the other
-- APPEND_ONLY tables. Sprint-04 EVT-023.
--
-- EVT-021 gave the table an append-only trigger that refused DELETE outright.
-- DATABASE_SCHEMA.md §2.5 puts it in the same regime as security_events and
-- audit_logs — "purge par rétention uniquement" — and those two already carry
-- the escape migration 8 introduced. Without it the table can only ever grow,
-- and it gains a row on every single refresh.
--
-- The flag is transaction-scoped (SET LOCAL), so it cannot leak into another
-- statement on a pooled connection, and it has to be set deliberately by
-- whoever runs the purge.
CREATE OR REPLACE FUNCTION "reject_rotation_rewrite"()
  RETURNS TRIGGER
  LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF coalesce(current_setting('eventini.retention_purge', true), 'off') <> 'on' THEN
      RAISE EXCEPTION
        'APPEND_ONLY: refresh_token_rotations rows cannot be deleted outside a retention purge'
        USING ERRCODE = 'check_violation';
    END IF;

    RETURN OLD;
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
