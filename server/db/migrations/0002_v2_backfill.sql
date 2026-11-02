-- Collabo V2 data backfill (hand-written, idempotent, non-destructive).
--
-- Drizzle applies every pending migration inside ONE transaction, so if anything
-- below fails, the schema migration before it is rolled back too: the database is
-- never left half-upgraded.
--
-- It only INSERTs new rows and fills columns that are NULL. It deletes nothing,
-- and `tasks.assigned_to_member_id` is left exactly as it was.

-- 1. Every task that had a single assignee gets the equivalent task_assignees row,
--    keeping that person's status and completion. Tasks completed in V1 stay completed
--    (their one assignee row is completed, and the task's own completion fields are untouched).
--    `started_at` is taken from the first time the task was recorded as started or done,
--    falling back to the task's last update.
INSERT INTO "task_assignees" (
  "project_id", "task_id", "member_id", "status",
  "assigned_at", "assigned_by_member_id",
  "started_at", "completed_at",
  "updated_at", "updated_by_member_id", "version"
)
SELECT
  t."project_id", t."id", t."assigned_to_member_id", t."status",
  t."created_at", t."created_by_member_id",
  CASE
    WHEN t."status" IN ('in_progress', 'completed') THEN COALESCE(
      (SELECT min(a."created_at") FROM "task_activity" a
        WHERE a."task_id" = t."id" AND a."to_status" IN ('in_progress', 'completed')),
      t."updated_at")
  END,
  t."completed_at",
  t."updated_at", t."updated_by_member_id", 1
FROM "tasks" t
WHERE t."assigned_to_member_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "task_assignees" ta
    WHERE ta."task_id" = t."id" AND ta."member_id" = t."assigned_to_member_id" AND ta."removed_at" IS NULL
  );
--> statement-breakpoint

-- 2. Snapshot the acting member's name onto existing history, so activity stays readable
--    after a member is renamed or deactivated. (Old rows keep their member id as well.)
UPDATE "task_activity" a
SET "actor_name" = m."name"
FROM "members" m
WHERE m."id" = a."member_id" AND m."project_id" = a."project_id" AND a."actor_name" IS NULL;
--> statement-breakpoint

-- Tasks that had NO assignee in V1 (assigned_to_member_id IS NULL) intentionally get no
-- assignee row: V2 requires at least one assignee, and guessing one would be wrong. They keep
-- working and are listed by `npm run db:v2:verify` so a person can assign them.
