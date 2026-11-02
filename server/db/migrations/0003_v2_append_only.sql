-- Collabo V2: make history genuinely append-only at the database level.
--
-- * task_activity and task_note_revisions: rows can never be UPDATED. (They are still removed
--   with their task by ON DELETE CASCADE; there is no way to edit them.)
-- * admin_audit_logs: rows can never be UPDATED, DELETED or TRUNCATED.
--
-- This runs after the backfill on purpose: the backfill updates task_activity.actor_name once.

CREATE FUNCTION "collabo_reject_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows cannot be updated', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE FUNCTION "collabo_reject_delete"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: rows cannot be deleted', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

CREATE TRIGGER "task_activity_append_only"
  BEFORE UPDATE ON "task_activity"
  FOR EACH ROW EXECUTE FUNCTION "collabo_reject_update"();
--> statement-breakpoint

CREATE TRIGGER "task_note_revisions_append_only"
  BEFORE UPDATE ON "task_note_revisions"
  FOR EACH ROW EXECUTE FUNCTION "collabo_reject_update"();
--> statement-breakpoint

CREATE TRIGGER "admin_audit_logs_no_update"
  BEFORE UPDATE ON "admin_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "collabo_reject_update"();
--> statement-breakpoint

CREATE TRIGGER "admin_audit_logs_no_delete"
  BEFORE DELETE ON "admin_audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "collabo_reject_delete"();
--> statement-breakpoint

CREATE TRIGGER "admin_audit_logs_no_truncate"
  BEFORE TRUNCATE ON "admin_audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION "collabo_reject_delete"();
