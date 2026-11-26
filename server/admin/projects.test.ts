import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type {
  ActivityDto,
  AdminAuditEntryDto,
  AdminOverviewDto,
  AdminProjectSummaryDto,
  MemberDto,
  Paged,
  TaskDto,
} from '../../shared/types.js'
import { adminAuditLogs } from '../db/schema.js'
import { pgErrorCode } from '../errors.js'
import { createCollabo, createTask, joinWithCode, TestClient } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { type AdminClient, signedInAdmin } from '../test/admin.js'

let database: TestDatabase
let admin: AdminClient
beforeAll(async () => {
  database = await createTestDatabase()
  admin = await signedInAdmin(database.db, 'Ada Admin')
})
afterAll(() => database.close())

const codeOf = (result: { body: unknown }) => (result.body as ApiErrorBody).error.code
const projectPath = (id: string) => `/api/admin/projects/${id}`
const list = (query = '') => admin.get<Paged<AdminProjectSummaryDto>>(`/api/admin/projects${query}`)

async function auditFor(projectId: string): Promise<AdminAuditEntryDto[]> {
  const result = await admin.get<Paged<AdminAuditEntryDto>>(`${projectPath(projectId)}/audit?limit=100`)
  expect(result.status).toBe(200)
  return result.body.items
}

describe('project directory', () => {
  it('finds projects by name, by a member name, or by id, and treats % and _ literally', async () => {
    const alpha = await createCollabo({ name: 'Zebra Crossing 100%', creatorName: 'Quentin', memberNames: ['Xiomara'] })
    const beta = await createCollabo({ name: 'Zebra_Quiet', creatorName: 'Rowan', memberNames: [] })

    const byName = await list('?search=zebra')
    expect(byName.body.items.map((item) => item.id).sort()).toEqual([alpha.projectId, beta.projectId].sort())

    const byMember = await list('?search=xiomara')
    expect(byMember.body.items.map((item) => item.id)).toEqual([alpha.projectId])

    const byId = await list(`?search=${alpha.projectId.slice(0, 8)}`)
    expect(byId.body.items.map((item) => item.id)).toEqual([alpha.projectId])

    const percent = await list(`?search=${encodeURIComponent('100%')}`)
    expect(percent.body.items.map((item) => item.id)).toEqual([alpha.projectId])
    const underscore = await list(`?search=${encodeURIComponent('Zebra_Q')}`)
    expect(underscore.body.items.map((item) => item.id)).toEqual([beta.projectId])
    const wildcard = await list(`?search=${encodeURIComponent('Z%Q')}`)
    expect(wildcard.body.items).toEqual([])
  })

  it('pages through every project with a total, and sorts by name', async () => {
    for (const name of ['Paging A', 'Paging B', 'Paging C']) await createCollabo({ name })
    const first = await list('?search=paging&limit=2&sort=name')
    expect(first.body.items.map((item) => item.name)).toEqual(['Paging A', 'Paging B'])
    expect(first.body).toMatchObject({ page: 1, pageSize: 2, total: 3, hasMore: true })
    const second = await list('?search=paging&limit=2&page=2&sort=name')
    expect(second.body.items.map((item) => item.name)).toEqual(['Paging C'])
    expect(second.body.hasMore).toBe(false)
  })

  it('shows member and task counts', async () => {
    const team = await createCollabo({ name: 'Counted', creatorName: 'Cora', memberNames: ['Dev', 'Eli'] })
    await createTask(team.client, { title: 'One' })
    const done = await createTask(team.client, { title: 'Two' })
    await team.client.put(`/api/tasks/${done.id}/assignees/${team.creator.id}/status`, {
      body: { status: 'completed', expectedAssigneeVersion: done.assignees[0]!.version },
    })
    const found = (await list('?search=counted')).body.items[0]!
    expect(found).toMatchObject({ activeMembers: 3, tasks: 2, openTasks: 1, status: 'active' })
  })

  it('reports platform-wide numbers', async () => {
    const result = await admin.get<{ overview: AdminOverviewDto }>('/api/admin/overview')
    expect(result.status).toBe(200)
    const { overview } = result.body
    expect(overview.projects.total).toBeGreaterThanOrEqual(5)
    expect(overview.projects.total).toBe(overview.projects.active + overview.projects.suspended + overview.projects.deleted)
    expect(overview.tasks.total).toBe(overview.tasks.todo + overview.tasks.inProgress + overview.tasks.completed)
    expect(overview.members.active).toBeGreaterThan(0)
  })

  it('answers unknown or malformed project ids with 404', async () => {
    expect((await admin.get<ApiErrorBody>(projectPath('00000000-0000-4000-8000-000000000000'))).status).toBe(404)
    expect((await admin.get<ApiErrorBody>(projectPath('not-a-uuid'))).status).toBe(404)
    expect((await admin.get<ApiErrorBody>(`${projectPath('not-a-uuid')}/tasks`)).status).toBe(404)
  })
})

describe('suspending a project', () => {
  it('locks out its members everywhere, keeps their data, and can be undone', async () => {
    const team = await createCollabo({ name: 'To suspend' })
    const task = await createTask(team.client, { title: 'Survives suspension' })

    const noReason = await admin.post<ApiErrorBody>(`${projectPath(team.projectId)}/suspend`, { body: {} })
    expect(noReason.status).toBe(400)
    expect(codeOf(noReason)).toBe('VALIDATION_ERROR')
    expect((await team.client.get('/api/tasks')).status).toBe(200)

    const done = await admin.post<{ project: AdminProjectSummaryDto }>(`${projectPath(team.projectId)}/suspend`, {
      body: { reason: 'Reported abuse, case 4411' },
    })
    expect(done.status).toBe(200)
    expect(done.body.project).toMatchObject({ status: 'suspended' })
    expect(done.body.project.suspendedAt).toBeTruthy()

    // Existing sessions, API calls of every kind, and fresh entry with the code are all refused.
    for (const attempt of [
      team.client.get<ApiErrorBody>('/api/tasks'),
      team.client.get<ApiErrorBody>('/api/members'),
      team.client.get<ApiErrorBody>('/api/project'),
      team.client.post<ApiErrorBody>('/api/tasks', { body: { title: 'x', assigneeIds: [team.creator.id] } }),
      team.client.put<ApiErrorBody>(`/api/tasks/${task.id}/assignees/${team.creator.id}/status`, {
        body: { status: 'completed', expectedAssigneeVersion: 1 },
      }),
    ]) {
      const result = await attempt
      expect(result.status).toBe(423)
      expect(codeOf(result)).toBe('PROJECT_SUSPENDED')
    }
    const entry = await new TestClient().post<ApiErrorBody>('/api/session', { body: { code: team.code } })
    expect(entry.status).toBe(423)
    expect(codeOf(entry)).toBe('PROJECT_SUSPENDED')

    // An administrator still sees and can fix everything inside it.
    const tasks = await admin.get<{ tasks: TaskDto[] }>(`${projectPath(team.projectId)}/tasks`)
    expect(tasks.body.tasks.map((item) => item.title)).toEqual(['Survives suspension'])

    const twice = await admin.post<ApiErrorBody>(`${projectPath(team.projectId)}/suspend`, {
      body: { reason: 'Again, for good measure' },
    })
    expect(twice.status).toBe(409)
    expect(codeOf(twice)).toBe('PROJECT_STATE_INVALID')

    const back = await admin.post<{ project: AdminProjectSummaryDto }>(`${projectPath(team.projectId)}/reactivate`, {
      body: { reason: 'Resolved' },
    })
    expect(back.body.project).toMatchObject({ status: 'active', suspendedAt: null })
    // The very same cookie works again, and nothing was lost.
    const after = await team.client.get<{ tasks: TaskDto[] }>('/api/tasks')
    expect(after.status).toBe(200)
    expect(after.body.tasks).toHaveLength(1)

    const trail = await auditFor(team.projectId)
    expect(trail.map((row) => row.action)).toEqual(['project.reactivate', 'project.suspend'])
    expect(trail[1]).toMatchObject({ reason: 'Reported abuse, case 4411', adminName: 'Ada Admin', targetId: team.projectId })
  })
})

describe('deleting and recovering a project', () => {
  it('hides it from ordinary access without destroying anything, and brings it back intact', async () => {
    const team = await createCollabo({ name: 'To delete' })
    const task = await createTask(team.client, { title: 'Still here later' })
    // A teammate whose browser does not touch Collabo while it is deleted.
    const sleeper = team.client.clone()

    const deleted = await admin.post<{ project: AdminProjectSummaryDto }>(`${projectPath(team.projectId)}/delete`, {
      body: { reason: 'Owner asked us to delete it' },
    })
    expect(deleted.body.project).toMatchObject({ status: 'deleted' })

    // To its members it simply no longer exists, and the old code looks like a wrong one.
    const cookieUse = await team.client.get<ApiErrorBody>('/api/tasks')
    expect(cookieUse.status).toBe(401)
    expect(codeOf(cookieUse)).toBe('SESSION_INVALID')
    const entry = await new TestClient().post<ApiErrorBody>('/api/session', { body: { code: team.code } })
    expect(entry.status).toBe(401)
    expect(codeOf(entry)).toBe('INVALID_CODE')

    // Admins can look, but not change, until it is recovered.
    expect((await admin.get<{ tasks: TaskDto[] }>(`${projectPath(team.projectId)}/tasks`)).body.tasks).toHaveLength(1)
    const blocked = await admin.post<ApiErrorBody>(`${projectPath(team.projectId)}/tasks`, {
      body: { title: 'No', assigneeIds: [team.creator.id] },
    })
    expect(blocked.status).toBe(409)
    expect(codeOf(blocked)).toBe('PROJECT_STATE_INVALID')
    expect(codeOf(await admin.post<ApiErrorBody>(`${projectPath(team.projectId)}/rotate-code`, { body: { reason: 'nope nope' } }))).toBe('PROJECT_STATE_INVALID')

    // The directory still lists it, under its own filter.
    const filtered = await list('?status=deleted&search=to%20delete')
    expect(filtered.body.items.map((item) => item.id)).toEqual([team.projectId])
    expect(filtered.body.items[0]!.deletedAt).toBeTruthy()
    expect((await list('?status=active&search=to%20delete')).body.items).toEqual([])

    const restored = await admin.post<{ project: AdminProjectSummaryDto }>(`${projectPath(team.projectId)}/restore`, { body: {} })
    expect(restored.body.project).toMatchObject({ status: 'active', deletedAt: null })
    // A browser that already hit the wall was told to forget its cookie, so it signs in again
    // with the same code; one that did not is simply let back in. Nothing was lost either way.
    expect((await team.client.get('/api/tasks')).status).toBe(401)
    const rejoined = await joinWithCode(team.code)
    rejoined.memberId = team.creator.id
    for (const person of [rejoined, sleeper]) {
      const back = await person.get<{ tasks: TaskDto[] }>('/api/tasks')
      expect(back.status).toBe(200)
      expect(back.body.tasks.map((item) => item.id)).toEqual([task.id])
    }

    expect((await auditFor(team.projectId)).map((row) => row.action)).toEqual(['project.restore', 'project.delete'])
  })

  it('restores a project that was suspended before deletion to suspended, not active', async () => {
    const team = await createCollabo({ name: 'Suspended then deleted' })
    await admin.post(`${projectPath(team.projectId)}/suspend`, { body: { reason: 'under review' } })
    await admin.post(`${projectPath(team.projectId)}/delete`, { body: { reason: 'cleanup' } })
    const restored = await admin.post<{ project: AdminProjectSummaryDto }>(`${projectPath(team.projectId)}/restore`, { body: {} })
    expect(restored.body.project.status).toBe('suspended')
    expect((await team.client.get<ApiErrorBody>('/api/tasks')).status).toBe(423)
  })

  it('refuses to restore a project that is not deleted', async () => {
    const team = await createCollabo()
    const result = await admin.post<ApiErrorBody>(`${projectPath(team.projectId)}/restore`, { body: {} })
    expect(result.status).toBe(409)
  })
})

describe('rotating a project access code', () => {
  it('shows the new code once, kills the old code and every old session, and never logs either', async () => {
    const team = await createCollabo({ name: 'To rotate' })
    const other = await joinWithCode(team.code)
    expect((await other.get('/api/project')).status).toBe(200)

    expect((await admin.post(`${projectPath(team.projectId)}/rotate-code`, { body: {} })).status).toBe(400)

    const rotated = await admin.post<{ accessCode: string; project: AdminProjectSummaryDto }>(
      `${projectPath(team.projectId)}/rotate-code`,
      { body: { reason: 'Code was posted publicly' } },
    )
    expect(rotated.status).toBe(200)
    const newCode = rotated.body.accessCode
    expect(newCode).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/)
    expect(newCode).not.toBe(team.code)
    expect(rotated.headers.get('cache-control')).toBe('no-store')

    // Old code and old sessions are dead; the new code works.
    const oldCode = await new TestClient().post<ApiErrorBody>('/api/session', { body: { code: team.code } })
    expect(codeOf(oldCode)).toBe('INVALID_CODE')
    expect(codeOf(await team.client.get<ApiErrorBody>('/api/tasks'))).toBe('SESSION_INVALID')
    expect(codeOf(await other.get<ApiErrorBody>('/api/project'))).toBe('SESSION_INVALID')
    expect((await joinWithCode(newCode)).sessionCookie).toBeDefined()

    // The code appears in no read-back: not the project, not the directory, not the audit log.
    const everything = JSON.stringify([
      (await admin.get(projectPath(team.projectId))).body,
      (await list('?search=to%20rotate')).body,
      await auditFor(team.projectId),
      (await admin.get('/api/admin/audit?limit=100')).body,
      await database.db.select().from(adminAuditLogs),
    ])
    expect(everything).not.toContain(newCode)
    expect(everything).not.toContain(team.code)
    expect(everything).not.toContain(newCode.replaceAll('-', ''))
    const trail = await auditFor(team.projectId)
    expect(trail[0]).toMatchObject({ action: 'project.rotate_code', reason: 'Code was posted publicly' })

    const again = await admin.post<{ accessCode: string }>(`${projectPath(team.projectId)}/rotate-code`, {
      body: { reason: 'rotating again' },
    })
    expect(again.body.accessCode).not.toBe(newCode)
  })
})

describe('renaming a project', () => {
  it('changes the name, shows it to members, and records before and after', async () => {
    const team = await createCollabo({ name: 'Old name' })
    const renamed = await admin.patch<{ project: AdminProjectSummaryDto }>(projectPath(team.projectId), {
      body: { name: 'New name', reason: 'Typo' },
    })
    expect(renamed.status).toBe(200)
    expect((await team.client.get<{ project: { name: string } }>('/api/project')).body.project.name).toBe('New name')
    const [entry] = await auditFor(team.projectId)
    expect(entry).toMatchObject({ action: 'project.rename', reason: 'Typo', summary: { from: 'Old name', to: 'New name' } })

    expect((await admin.patch(projectPath(team.projectId), { body: { name: '   ' } })).status).toBe(400)
  })
})

describe('an administrator working inside a project', () => {
  it('sees and manages members and tasks, with their own identity recorded', async () => {
    const team = await createCollabo({ name: 'Managed', creatorName: 'Cora', memberNames: ['Dev'] })
    const base = projectPath(team.projectId)

    const added = await admin.post<{ members: MemberDto[] }>(`${base}/members`, { body: { names: ['Ezra', 'Fia'] } })
    expect(added.status).toBe(201)
    const members = (await admin.get<{ members: MemberDto[] }>(`${base}/members`)).body.members
    expect(members.map((member) => member.name)).toEqual(['Cora', 'Dev', 'Ezra', 'Fia'])

    const created = await admin.post<{ task: TaskDto }>(`${base}/tasks`, {
      body: { title: 'Admin-made task', assigneeIds: [team.creator.id, team.member('Dev').id], assignmentMode: 'all' },
    })
    expect(created.status).toBe(201)
    expect(created.body.task.createdBy).toMatchObject({ type: 'admin' })

    // Members see the task, attributed to "Collabo admin", never to a person.
    const seen = await team.client.get<{ task: TaskDto }>(`/api/tasks/${created.body.task.id}`)
    expect(seen.body.task.createdBy).toEqual({ type: 'admin', memberId: null, name: 'Collabo admin' })
    expect(JSON.stringify(seen.body)).not.toMatch(/Ada Admin|@example\.com/)

    const renamed = await admin.patch(`${base}/members/${team.member('Dev').id}`, { body: { name: 'Devon' } })
    expect(renamed.status).toBe(200)
    const trail = (await auditFor(team.projectId)).map((row) => row.action)
    expect(trail).toEqual(expect.arrayContaining(['member.add', 'task.create', 'member.rename']))
  })

  it("requires a reason to change someone else's progress, and shows it to admins only", async () => {
    const team = await createCollabo({ name: 'Overrides', creatorName: 'Cora', memberNames: ['Dev'] })
    const dev = team.member('Dev')
    const task = await createTask(team.client, {
      title: 'Joint work',
      assigneeIds: [team.creator.id, dev.id],
      assignmentMode: 'all',
    })
    const url = `${projectPath(team.projectId)}/tasks/${task.id}/assignees/${dev.id}/status`
    const version = task.assignees.find((row) => row.memberId === dev.id)!.version

    const without = await admin.put<ApiErrorBody>(url, { body: { status: 'completed', expectedAssigneeVersion: version } })
    expect(without.status).toBe(422)
    expect(codeOf(without)).toBe('REASON_REQUIRED')

    const done = await admin.put<{ task: TaskDto }>(url, {
      body: { status: 'completed', expectedAssigneeVersion: version, reason: 'Dev confirmed by phone' },
    })
    expect(done.status).toBe(200)
    expect(done.body.task.assignees.find((row) => row.memberId === dev.id)!.status).toBe('completed')

    const forAdmin = await admin.get<{ activity: ActivityDto[] }>(`${projectPath(team.projectId)}/tasks/${task.id}/activity`)
    const adminEntry = forAdmin.body.activity.find((entry) => entry.action === 'assignee_status_changed')!
    expect(adminEntry.actor).toMatchObject({ type: 'admin', name: 'Ada Admin' })
    expect(JSON.stringify(adminEntry)).toContain('Dev confirmed by phone')

    const forMember = await team.client.get<{ activity: ActivityDto[] }>(`/api/tasks/${task.id}/activity`)
    const memberEntry = forMember.body.activity.find((entry) => entry.action === 'assignee_status_changed')!
    expect(memberEntry.actor).toEqual({ type: 'admin', memberId: null, name: 'Collabo admin' })
    expect(JSON.stringify(forMember.body)).not.toContain('Dev confirmed by phone')
    expect(JSON.stringify(forMember.body)).not.toMatch(/Ada Admin|@example\.com/)

    const logged = (await auditFor(team.projectId)).find((row) => row.action === 'task.progress_override')
    expect(logged).toMatchObject({ reason: 'Dev confirmed by phone', adminName: 'Ada Admin' })
  })

  it('cannot reach another project through a project-scoped admin route', async () => {
    const a = await createCollabo({ name: 'Scope A' })
    const b = await createCollabo({ name: 'Scope B' })
    const taskOfB = await createTask(b.client, { title: 'B only' })
    const through = await admin.get<ApiErrorBody>(`${projectPath(a.projectId)}/tasks/${taskOfB.id}`)
    expect(through.status).toBe(404)
    expect(codeOf(through)).toBe('TASK_NOT_FOUND')
    const edit = await admin.patch<ApiErrorBody>(`${projectPath(a.projectId)}/tasks/${taskOfB.id}`, {
      body: { title: 'Hijacked', expectedVersion: taskOfB.version },
    })
    expect(edit.status).toBe(404)
    expect((await b.client.get<{ task: TaskDto }>(`/api/tasks/${taskOfB.id}`)).body.task.title).toBe('B only')
  })

  it('leaves neither a change nor an audit row behind when a request fails', async () => {
    const team = await createCollabo({ name: 'Atomic' })
    const before = (await auditFor(team.projectId)).length
    const bad = await admin.post<ApiErrorBody>(`${projectPath(team.projectId)}/tasks`, {
      body: { title: 'Ghost', assigneeIds: ['00000000-0000-4000-8000-000000000000'] },
    })
    expect(bad.status).toBeGreaterThanOrEqual(400)
    expect((await auditFor(team.projectId)).length).toBe(before)
    expect((await admin.get<{ tasks: TaskDto[] }>(`${projectPath(team.projectId)}/tasks`)).body.tasks).toEqual([])
  })
})

describe('the audit log', () => {
  it('cannot be edited, deleted or emptied, even by the application', async () => {
    const team = await createCollabo({ name: 'Audited' })
    await admin.post(`${projectPath(team.projectId)}/suspend`, { body: { reason: 'for the log' } })

    const update = database.db.execute(sql`update admin_audit_logs set reason = 'rewritten'`)
    await expect(update).rejects.toSatisfy((error) => pgErrorCode(error) === '23001')
    const remove = database.db.execute(sql`delete from admin_audit_logs`)
    await expect(remove).rejects.toSatisfy((error) => pgErrorCode(error) === '23001')
    const truncate = database.db.execute(sql`truncate admin_audit_logs`)
    await expect(truncate).rejects.toSatisfy((error) => pgErrorCode(error) === '23001')

    expect((await auditFor(team.projectId))[0]!.reason).toBe('for the log')
  })

  it('filters by project, action and administrator, newest first, with paging', async () => {
    const team = await createCollabo({ name: 'Filtered' })
    for (const [action, reason] of [['suspend', 'one one'], ['reactivate', 'two two'], ['suspend', 'three three']] as const) {
      await admin.post(`${projectPath(team.projectId)}/${action}`, { body: { reason } })
    }
    const all = await auditFor(team.projectId)
    expect(all.map((row) => row.reason)).toEqual(['three three', 'two two', 'one one'])

    const suspends = await admin.get<Paged<AdminAuditEntryDto>>(
      `/api/admin/audit?projectId=${team.projectId}&action=project.suspend&limit=1`,
    )
    expect(suspends.body.items).toHaveLength(1)
    expect(suspends.body).toMatchObject({ total: 2, hasMore: true })

    const me = (await admin.get<{ admin: { id: string } }>('/api/admin/me')).body.admin.id
    const mine = await admin.get<Paged<AdminAuditEntryDto>>(`/api/admin/audit?adminId=${me}&projectId=${team.projectId}`)
    expect(mine.body.total).toBe(3)
    const nobody = await admin.get<Paged<AdminAuditEntryDto>>(`/api/admin/audit?adminId=someone-else&projectId=${team.projectId}`)
    expect(nobody.body.items).toEqual([])
  })

  it('names who did what even after that administrator is renamed or deactivated', async () => {
    const other = await signedInAdmin(database.db, 'Temporary Tom')
    const team = await createCollabo({ name: 'Remembered' })
    await other.post(`${projectPath(team.projectId)}/suspend`, { body: { reason: 'tom did this' } })
    const tomId = (await other.get<{ admin: { id: string } }>('/api/admin/me')).body.admin.id
    await admin.post(`/api/admin/admins/${tomId}/deactivate`, { body: {} })
    const [entry] = await auditFor(team.projectId)
    expect(entry).toMatchObject({ adminName: 'Temporary Tom', action: 'project.suspend', adminId: tomId })
  })
})
