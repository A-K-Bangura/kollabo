import { sql } from 'drizzle-orm'
import type { Database } from './client.js'

export type CheckSeverity = 'info' | 'warning' | 'failure'

export interface VerifyCheck {
  name: string
  /** Rows that break the rule (or the plain count, for `info`). */
  count: number
  severity: CheckSeverity
  /** What the number means and what to do about it. */
  detail: string
}

async function count(db: Database, query: ReturnType<typeof sql>): Promise<number> {
  const result = await db.execute<{ n: number }>(query)
  const rows = (result as unknown as { rows: { n: number | string }[] }).rows
  return Number(rows[0]?.n ?? 0)
}

/**
 * Read-only health report for a database that has been migrated to V2: whether the
 * backfill carried every V1 task across, whether the derived data agrees with itself,
 * and whether the safeguards (append-only triggers) are in place. It never changes
 * anything, so it is safe to run against production at any time.
 */
export async function verifyV2(db: Database): Promise<VerifyCheck[]> {
  const checks: VerifyCheck[] = []
  const add = (name: string, n: number, severity: CheckSeverity, detail: string) =>
    checks.push({ name, count: n, severity: n === 0 && severity !== 'info' ? 'info' : severity, detail })

  for (const [label, table] of [
    ['projects', 'projects'],
    ['members', 'members'],
    ['tasks', 'tasks'],
    ['active task assignments', 'task_assignees where removed_at is null'],
    ['activity entries', 'task_activity'],
    ['note revisions', 'task_note_revisions'],
    ['administrators', 'admin_accounts'],
  ] as const) {
    checks.push({
      name: `Rows: ${label}`,
      count: await count(db, sql.raw(`select count(*)::int as n from ${table}`)),
      severity: 'info',
      detail: 'For comparison with the counts you noted before migrating.',
    })
  }

  add(
    'V1 tasks missing their assignee row',
    await count(
      db,
      sql`select count(*)::int as n from tasks t
          where t.assigned_to_member_id is not null
            and not exists (select 1 from task_assignees a where a.task_id = t.id)`,
    ),
    'failure',
    'The backfill (migration 0002) did not run or was incomplete. Every task that had a V1 assignee must have an assignee row.',
  )

  add(
    'Tasks with nobody assigned',
    await count(
      db,
      sql`select count(*)::int as n from tasks t
          where not exists (select 1 from task_assignees a where a.task_id = t.id and a.removed_at is null)`,
    ),
    'warning',
    'These were unassigned in V1 too. They are valid, but nobody can mark progress on them: assign someone (an administrator can do this from the project page).',
  )

  add(
    'Open tasks whose assignees have all been removed from the team',
    await count(
      db,
      sql`select count(*)::int as n from tasks t
          where t.status <> 'completed'
            and exists (select 1 from task_assignees a where a.task_id = t.id and a.removed_at is null)
            and not exists (
              select 1 from task_assignees a join members m on m.id = a.member_id
              where a.task_id = t.id and a.removed_at is null and m.is_active)`,
    ),
    'warning',
    'Nobody active can progress these. Reassign them.',
  )

  add(
    'ALL-mode tasks whose status disagrees with their assignees',
    await count(
      db,
      sql`select count(*)::int as n from (
            select t.id, t.status,
              count(*) filter (where a.removed_at is null) as active,
              count(*) filter (where a.removed_at is null and a.status = 'completed') as done,
              count(*) filter (where a.removed_at is null and a.status = 'in_progress') as doing
            from tasks t join task_assignees a on a.task_id = t.id
            where t.assignment_mode = 'all'
            group by t.id, t.status
          ) s
          where s.active > 0 and s.status::text <> case
            when s.done = s.active then 'completed'
            when s.done + s.doing > 0 then 'in_progress'
            else 'todo' end`,
    ),
    'failure',
    "The task's aggregate status should always equal what its assignees imply.",
  )

  add(
    'Completed tasks without a completion time or with the wrong shape',
    await count(
      db,
      sql`select count(*)::int as n from tasks where (status = 'completed') <> (completed_at is not null)`,
    ),
    'failure',
    'A completed task must have exactly one completion record.',
  )

  add(
    'Assignments linking a task to a member of another project',
    await count(
      db,
      sql`select count(*)::int as n from task_assignees a
          join members m on m.id = a.member_id
          where m.project_id <> a.project_id`,
    ),
    'failure',
    'Should be impossible (composite foreign keys). Investigate immediately.',
  )

  add(
    "Tasks whose legacy 'assigned_to_member_id' differs from their first assignee",
    await count(
      db,
      sql`select count(*)::int as n from tasks t
          where t.assigned_to_member_id is distinct from (
            select a.member_id from task_assignees a
            where a.task_id = t.id and a.removed_at is null
            order by a.assigned_at, a.id limit 1)
            and exists (select 1 from task_assignees a where a.task_id = t.id and a.removed_at is null)`,
    ),
    'warning',
    'Only matters if you roll the application back to V1, which reads that column.',
  )

  add(
    'Tasks whose note version disagrees with their revision history',
    await count(
      db,
      sql`select count(*)::int as n from tasks t
          where t.progress_note_version <> coalesce((select max(r.revision_number) from task_note_revisions r where r.task_id = t.id), 0)
             or t.progress_note is distinct from (
                  select case when r.is_clear then null else r.content end
                  from task_note_revisions r where r.task_id = t.id
                  order by r.revision_number desc limit 1)`,
    ),
    'failure',
    'The current note must always equal the latest revision.',
  )

  add(
    'Activity entries with no recorded actor name',
    await count(db, sql`select count(*)::int as n from task_activity where actor_name is null`),
    'warning',
    'Older entries are filled from the member name by the backfill; remaining ones will show as "Someone".',
  )

  const triggers = await count(
    db,
    sql`select count(*)::int as n from pg_trigger
        where tgname in ('task_activity_append_only','task_note_revisions_append_only',
                         'admin_audit_logs_no_update','admin_audit_logs_no_delete','admin_audit_logs_no_truncate')
          and not tgisinternal`,
  )
  add(
    'Append-only safeguards missing',
    5 - triggers,
    'failure',
    'History tables must refuse edits. Re-run migration 0003 (npm run db:migrate).',
  )

  const admins = await count(db, sql`select count(*)::int as n from admin_accounts where status = 'active'`)
  checks.push({
    name: 'Active administrators',
    count: admins,
    severity: admins === 0 ? 'warning' : 'info',
    detail:
      admins === 0
        ? 'No platform administrator exists yet. Create the first one with: npm run admin:create'
        : 'At least one administrator exists.',
  })

  return checks
}

export function hasFailures(checks: readonly VerifyCheck[]): boolean {
  return checks.some((check) => check.severity === 'failure' && check.count > 0)
}
