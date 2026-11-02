import { cp, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { hasFailures, verifyV2 } from './verify.js'

/**
 * Proves the V1 -> V2 upgrade on real data: build a database exactly as V1 left it
 * (migration 0000 only), fill it with V1-style rows, then apply the V2 migrations on top
 * the way `npm run db:migrate` does.
 */

const MIGRATIONS = path.resolve(import.meta.dirname, 'migrations')

interface Row {
  [column: string]: unknown
}

let client: PGlite
const ids = {
  p1: '11111111-1111-4111-8111-111111111111',
  p2: '22222222-2222-4222-8222-222222222222',
  alice: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  bob: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  carol: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  dave: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  tTodo: '00000000-0000-4000-8000-000000000001',
  tProgress: '00000000-0000-4000-8000-000000000002',
  tDone: '00000000-0000-4000-8000-000000000003',
  tUnassigned: '00000000-0000-4000-8000-000000000004',
  tInactive: '00000000-0000-4000-8000-000000000005',
  tOther: '00000000-0000-4000-8000-000000000006',
}

async function rows(sql: string, params: unknown[] = []): Promise<Row[]> {
  const result = await client.query<Row>(sql, params)
  return result.rows
}

async function applyOnlyV1(): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'collabo-v1-'))
  await mkdir(path.join(dir, 'meta'))
  await cp(path.join(MIGRATIONS, '0000_init.sql'), path.join(dir, '0000_init.sql'))
  const journal = JSON.parse(await readFile(path.join(MIGRATIONS, 'meta/_journal.json'), 'utf8'))
  journal.entries = journal.entries.slice(0, 1)
  await writeFile(path.join(dir, 'meta/_journal.json'), JSON.stringify(journal))
  await migrate(drizzle(client), { migrationsFolder: dir })
}

async function seedV1(): Promise<void> {
  await client.exec(`
    INSERT INTO projects (id, name, access_code_hash) VALUES
      ('${ids.p1}', 'Alpha', 'hash-alpha'), ('${ids.p2}', 'Beta', 'hash-beta');
    INSERT INTO members (id, project_id, name, is_active) VALUES
      ('${ids.alice}', '${ids.p1}', 'Alice', true),
      ('${ids.bob}', '${ids.p1}', 'Bob', true),
      ('${ids.carol}', '${ids.p1}', 'Carol', false),
      ('${ids.dave}', '${ids.p2}', 'Dave', true);

    INSERT INTO tasks (id, project_id, title, status, assigned_to_member_id, created_by_member_id,
                       updated_by_member_id, created_at, updated_at, completed_by_member_id, completed_at, version)
    VALUES
      ('${ids.tTodo}', '${ids.p1}', 'Plan', 'todo', '${ids.alice}', '${ids.alice}', '${ids.alice}',
        '2026-09-01T09:00:00Z', '2026-09-01T09:00:00Z', NULL, NULL, 1),
      ('${ids.tProgress}', '${ids.p1}', 'Build', 'in_progress', '${ids.bob}', '${ids.alice}', '${ids.bob}',
        '2026-09-01T09:05:00Z', '2026-09-02T10:00:00Z', NULL, NULL, 2),
      ('${ids.tDone}', '${ids.p1}', 'Ship', 'completed', '${ids.alice}', '${ids.alice}', '${ids.alice}',
        '2026-09-01T09:10:00Z', '2026-09-03T11:00:00Z', '${ids.alice}', '2026-09-03T11:00:00Z', 3),
      ('${ids.tUnassigned}', '${ids.p1}', 'Someday', 'todo', NULL, '${ids.alice}', '${ids.alice}',
        '2026-09-01T09:15:00Z', '2026-09-01T09:15:00Z', NULL, NULL, 1),
      ('${ids.tInactive}', '${ids.p1}', 'Orphaned', 'todo', '${ids.carol}', '${ids.alice}', '${ids.alice}',
        '2026-09-01T09:20:00Z', '2026-09-01T09:20:00Z', NULL, NULL, 1),
      ('${ids.tOther}', '${ids.p2}', 'Other project', 'todo', '${ids.dave}', '${ids.dave}', '${ids.dave}',
        '2026-09-01T09:25:00Z', '2026-09-01T09:25:00Z', NULL, NULL, 1);

    INSERT INTO task_activity (project_id, task_id, member_id, action, from_status, to_status, created_at) VALUES
      ('${ids.p1}', '${ids.tTodo}', '${ids.alice}', 'created', NULL, NULL, '2026-09-01T09:00:00Z'),
      ('${ids.p1}', '${ids.tProgress}', '${ids.alice}', 'created', NULL, NULL, '2026-09-01T09:05:00Z'),
      ('${ids.p1}', '${ids.tProgress}', '${ids.bob}', 'status_changed', 'todo', 'in_progress', '2026-09-02T10:00:00Z'),
      ('${ids.p1}', '${ids.tDone}', '${ids.alice}', 'created', NULL, NULL, '2026-09-01T09:10:00Z'),
      ('${ids.p1}', '${ids.tDone}', '${ids.alice}', 'status_changed', 'todo', 'completed', '2026-09-03T11:00:00Z'),
      ('${ids.p2}', '${ids.tOther}', '${ids.dave}', 'created', NULL, NULL, '2026-09-01T09:25:00Z');
  `)
}

beforeAll(async () => {
  client = new PGlite()
  await applyOnlyV1()
  await seedV1()
  // Now upgrade exactly as `npm run db:migrate` would.
  await migrate(drizzle(client), { migrationsFolder: MIGRATIONS })
})
afterAll(() => client.close())

describe('V1 -> V2 migration with existing data', () => {
  it('keeps every existing project, member, task and activity row', async () => {
    expect((await rows('select count(*)::int as n from projects'))[0]?.n).toBe(2)
    expect((await rows('select count(*)::int as n from members'))[0]?.n).toBe(4)
    expect((await rows('select count(*)::int as n from tasks'))[0]?.n).toBe(6)
    expect((await rows('select count(*)::int as n from task_activity'))[0]?.n).toBe(6)
  })

  it('leaves V1 task data untouched, including the legacy single-assignee column', async () => {
    const done = (await rows('select * from tasks where id = $1', [ids.tDone]))[0]!
    expect(done).toMatchObject({
      status: 'completed',
      assigned_to_member_id: ids.alice,
      completed_by_member_id: ids.alice,
      assignment_mode: 'all',
      progress_note: null,
      progress_note_version: 0,
      version: 3,
    })
    expect(done.completed_at).toEqual(new Date('2026-09-03T11:00:00Z'))
    expect(done.created_by_admin_id).toBeNull()
  })

  it('creates an assignee row for each single-assignee task, preserving status and completion', async () => {
    const assignees = await rows(
      'select task_id, member_id, status, started_at, completed_at, version, removed_at from task_assignees order by task_id',
    )
    expect(assignees.map((row) => [row.task_id, row.member_id, row.status])).toEqual([
      [ids.tTodo, ids.alice, 'todo'],
      [ids.tProgress, ids.bob, 'in_progress'],
      [ids.tDone, ids.alice, 'completed'],
      [ids.tInactive, ids.carol, 'todo'],
      [ids.tOther, ids.dave, 'todo'],
    ])

    const progress = assignees.find((row) => row.task_id === ids.tProgress)!
    expect(progress.started_at).toEqual(new Date('2026-09-02T10:00:00Z')) // from the real status_changed event
    expect(progress.completed_at).toBeNull()

    const done = assignees.find((row) => row.task_id === ids.tDone)!
    expect(done.completed_at).toEqual(new Date('2026-09-03T11:00:00Z'))
    expect(assignees.every((row) => row.removed_at === null && row.version === 1)).toBe(true)
  })

  it('does not invent an assignee for tasks that had none, and they remain visible for repair', async () => {
    expect(
      await rows('select 1 from task_assignees where task_id = $1', [ids.tUnassigned]),
    ).toHaveLength(0)
    expect((await rows('select status from tasks where id = $1', [ids.tUnassigned]))[0]?.status).toBe('todo')
  })

  it('keeps assignments inside their own project', async () => {
    const mismatched = await rows(`
      select ta.id from task_assignees ta
      join tasks t on t.id = ta.task_id
      join members m on m.id = ta.member_id
      where ta.project_id <> t.project_id or ta.project_id <> m.project_id`)
    expect(mismatched).toHaveLength(0)
    const other = await rows('select project_id from task_assignees where task_id = $1', [ids.tOther])
    expect(other[0]?.project_id).toBe(ids.p2)
  })

  it('snapshots actor names onto existing history', async () => {
    const history = await rows(
      "select actor_name, actor_type, admin_id from task_activity where task_id = $1 order by id",
      [ids.tProgress],
    )
    expect(history.map((row) => row.actor_name)).toEqual(['Alice', 'Bob'])
    expect(history.every((row) => row.actor_type === 'member' && row.admin_id === null)).toBe(true)
  })

  it('applies the new project defaults', async () => {
    const projects = await rows('select status, plan_key, billing_status, suspended_at, deleted_at from projects')
    expect(projects.every((p) => p.status === 'active' && p.plan_key === 'free')).toBe(true)
    expect(projects.every((p) => p.billing_status === null && p.suspended_at === null && p.deleted_at === null)).toBe(true)
  })

  it('makes history append-only at the database level', async () => {
    await expect(client.query("update task_activity set actor_name = 'Mallory'")).rejects.toMatchObject({
      code: '23001',
    })
    await expect(client.query("update task_activity set actor_name = 'Mallory' where id = 1")).rejects.toThrow(
      /append-only/,
    )
  })

  it('makes the admin audit log append-only (no update, delete or truncate)', async () => {
    await client.exec(`
      insert into admin_users (id, name, email) values ('admin-1', 'Root', 'root@example.test');
      insert into admin_audit_logs (admin_id, admin_name, admin_email, action, target_type)
      values ('admin-1', 'Root', 'root@example.test', 'project.suspend', 'project');`)
    await expect(client.query("update admin_audit_logs set action = 'x'")).rejects.toThrow(/append-only/)
    await expect(client.query('delete from admin_audit_logs')).rejects.toThrow(/append-only/)
    await expect(client.query('truncate admin_audit_logs')).rejects.toThrow(/append-only/)
    expect((await rows('select count(*)::int as n from admin_audit_logs'))[0]?.n).toBe(1)
  })

  it('passes the post-migration health check, flagging only what V1 data genuinely needed repair', async () => {
    const checks = await verifyV2(drizzle(client) as never)
    expect(hasFailures(checks)).toBe(false)
    const find = (name: string) => checks.find((check) => check.name.startsWith(name))
    // Seeded V1 data has one task nobody was assigned to, and one whose only assignee was removed.
    expect(find('Tasks with nobody assigned')).toMatchObject({ count: 1, severity: 'warning' })
    expect(find('Open tasks whose assignees')).toMatchObject({ count: 1, severity: 'warning' })
    expect(find('Rows: tasks')?.count).toBe(6)
    expect(find('Active administrators')).toMatchObject({ count: 0, severity: 'warning' })
  })

  it('still accepts V1-shaped writes, so an application rollback keeps working', async () => {
    // What V1 code did: insert a task with a member author and complete it with member columns.
    await client.exec(`
      insert into tasks (id, project_id, title, created_by_member_id, updated_by_member_id)
      values ('00000000-0000-4000-8000-0000000000aa', '${ids.p1}', 'Written by V1', '${ids.alice}', '${ids.alice}');
      update tasks set status = 'completed', completed_by_member_id = '${ids.alice}', completed_at = now()
      where id = '00000000-0000-4000-8000-0000000000aa';
      insert into task_activity (project_id, task_id, member_id, action)
      values ('${ids.p1}', '00000000-0000-4000-8000-0000000000aa', '${ids.alice}', 'created');`)
    expect(
      (await rows("select status from tasks where id = '00000000-0000-4000-8000-0000000000aa'"))[0]?.status,
    ).toBe('completed')
  })
})
