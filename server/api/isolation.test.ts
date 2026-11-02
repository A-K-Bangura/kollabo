import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { MemberDto, TaskDto } from '../../shared/types.js'
import { members, taskActivity, taskAssignees, taskNoteRevisions, tasks } from '../db/schema.js'
import { pgErrorCode } from '../errors.js'
import { createCollabo, createTask, joinWithCode, type Collabo } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { activityOf, revisionsOf, setStatus } from '../test/helpers.js'

const FOREIGN_KEY_VIOLATION = '23503'
const CHECK_VIOLATION = '23514'

let database: TestDatabase
let a: Collabo
let b: Collabo
let aTask: TaskDto
let bTask: TaskDto

beforeAll(async () => {
  database = await createTestDatabase()
  a = await createCollabo({ name: 'Collabo A', creatorName: 'Ann', memberNames: ['Amir'] })
  b = await createCollabo({ name: 'Collabo B', creatorName: 'Bea', memberNames: ['Bo'] })
  aTask = await createTask(a.client, { title: 'A secret plan' })
  bTask = await createTask(b.client, { title: 'B secret plan', assigneeIds: [b.creator.id, b.member('Bo').id] })
  await b.client.put(`/api/tasks/${bTask.id}/note`, { body: { content: 'B private note', expectedNoteVersion: 0 } })
})
afterAll(() => database.close())

describe('one Collabo can never see or touch another', () => {
  it('lists only its own tasks and members', async () => {
    const tasksA = await a.client.get<{ tasks: TaskDto[] }>('/api/tasks')
    expect(tasksA.body.tasks.map((task) => task.title)).toEqual(['A secret plan'])
    const membersA = await a.client.get<{ members: MemberDto[] }>('/api/members')
    expect(membersA.body.members.map((member) => member.name)).toEqual(['Ann', 'Amir'])
  })

  it("cannot read another Collabo's task, its history or its note revisions, even knowing the id", async () => {
    for (const path of [
      `/api/tasks/${bTask.id}`,
      `/api/tasks/${bTask.id}/activity`,
      `/api/tasks/${bTask.id}/note/revisions`,
    ]) {
      const result = await a.client.get<ApiErrorBody>(path)
      expect(result.status, path).toBe(404)
      expect(result.body.error.code).toBe('TASK_NOT_FOUND')
      expect(JSON.stringify(result.body)).not.toContain('B secret plan')
      expect(JSON.stringify(result.body)).not.toContain('B private note')
    }
  })

  it("cannot edit, progress, reopen, annotate or delete another Collabo's task", async () => {
    const bBefore = await b.client.get<{ task: TaskDto }>(`/api/tasks/${bTask.id}`)
    const attempts = await Promise.all([
      a.client.patch(`/api/tasks/${bTask.id}`, { body: { expectedVersion: bTask.version, title: 'Hijacked' } }),
      a.client.put(`/api/tasks/${bTask.id}/assignees/${b.creator.id}/status`, {
        body: { status: 'completed', expectedAssigneeVersion: 1 },
      }),
      a.client.put(`/api/tasks/${bTask.id}/assignees/${a.creator.id}/status`, {
        body: { status: 'completed', expectedAssigneeVersion: 1 },
      }),
      a.client.post(`/api/tasks/${bTask.id}/reopen`, { body: { expectedVersion: bTask.version } }),
      a.client.put(`/api/tasks/${bTask.id}/note`, { body: { content: 'Graffiti', expectedNoteVersion: 1 } }),
      a.client.delete(`/api/tasks/${bTask.id}/note?expectedNoteVersion=1`),
      a.client.delete(`/api/tasks/${bTask.id}`),
    ])
    for (const attempt of attempts) expect(attempt.status).toBe(404)

    const bAfter = await b.client.get<{ task: TaskDto }>(`/api/tasks/${bTask.id}`)
    expect(bAfter.body.task).toEqual(bBefore.body.task)
    expect(await revisionsOf(b.client, bTask.id)).toHaveLength(1)
    expect((await activityOf(b.client, bTask.id)).some((entry) => entry.actor.name === 'Ann')).toBe(false)
  })

  it("cannot rename, reactivate or remove another Collabo's member", async () => {
    const bo = b.member('Bo')
    expect((await a.client.patch(`/api/members/${bo.id}`, { body: { name: 'Hacked' } })).status).toBe(404)
    expect((await a.client.post(`/api/members/${bo.id}/reactivate`)).status).toBe(404)
    expect((await a.client.delete(`/api/members/${bo.id}`)).status).toBe(404)
    expect((await a.client.post(`/api/members/${bo.id}/deactivate`, { body: { reassignToMemberId: null } })).status).toBe(404)

    const membersB = await b.client.get<{ members: MemberDto[] }>('/api/members')
    expect(membersB.body.members.find((member) => member.id === bo.id)).toMatchObject({ name: 'Bo', isActive: true })
  })

  it("cannot act as, assign work to, or reassign work to another Collabo's members", async () => {
    const bea = b.creator

    const actingAs = await a.client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Impersonation', assigneeIds: [a.creator.id] },
      actor: bea.id,
    })
    expect(actingAs.body.error.code).toBe('MEMBER_REQUIRED')

    const assigning = await a.client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Cross-project assignee', assigneeIds: [a.creator.id, bea.id] },
    })
    expect(assigning.status).toBe(404)
    expect(assigning.body.error.code).toBe('MEMBER_NOT_FOUND')

    const reassigning = await a.client.patch<ApiErrorBody>(`/api/tasks/${aTask.id}`, {
      body: { expectedVersion: aTask.version, assigneeIds: [bea.id] },
    })
    expect(reassigning.body.error.code).toBe('MEMBER_NOT_FOUND')

    const handover = await a.client.post<ApiErrorBody>(`/api/members/${a.member('Amir').id}/deactivate`, {
      body: { reassignToMemberId: bea.id },
    })
    expect(handover.status).toBe(404)
  })

  it('binds a session to its own project: codes and cookies never cross over', async () => {
    const viaA = await joinWithCode(a.code)
    const viaB = await joinWithCode(b.code)
    const nameOf = async (client: typeof viaA) =>
      (await client.get<{ project: { name: string } }>('/api/project')).body.project.name

    expect(await nameOf(viaA)).toBe('Collabo A')
    expect(await nameOf(viaB)).toBe('Collabo B')
    expect(viaA.sessionCookie).not.toBe(viaB.sessionCookie)
  })

  it('ignores a project id sent by the client', async () => {
    const result = await a.client.get<{ tasks: TaskDto[] }>(`/api/tasks?projectId=${b.projectId}`, {
      headers: { 'x-project-id': b.projectId },
    })
    expect(result.body.tasks.map((task) => task.title)).toEqual(['A secret plan'])
  })

  it("keeps one Collabo's regenerated code from affecting another's sessions", async () => {
    const other = await createCollabo({ name: 'Collabo C' })
    await other.client.post('/api/project/regenerate-code')
    expect((await a.client.get('/api/tasks')).status).toBe(200)
    expect((await b.client.get('/api/tasks')).status).toBe(200)
  })

  it('does not let a project session reach any admin endpoint', async () => {
    for (const path of ['/api/admin/overview', '/api/admin/projects', `/api/admin/projects/${b.projectId}/tasks`]) {
      const result = await a.client.get<ApiErrorBody>(path)
      expect([401, 403, 503], path).toContain(result.status)
      expect(JSON.stringify(result.body)).not.toContain('B secret plan')
    }
  })
})

describe('the database itself refuses cross-project links', () => {
  const refused = (error: unknown, code: string) => pgErrorCode(error) === code

  it("rejects a task authored by, or assigned to, another project's member", async () => {
    const wrongAuthor = database.db.insert(tasks).values({
      projectId: a.projectId,
      title: 'Bad author',
      createdByMemberId: b.creator.id,
      updatedByMemberId: b.creator.id,
    })
    await expect(wrongAuthor).rejects.toSatisfy((error) => refused(error, FOREIGN_KEY_VIOLATION))

    const wrongMirror = database.db
      .update(tasks)
      .set({ assignedToMemberId: b.creator.id })
      .where(eq(tasks.id, aTask.id))
    await expect(wrongMirror).rejects.toSatisfy((error) => refused(error, FOREIGN_KEY_VIOLATION))
  })

  it("rejects an assignment of another project's member, or on another project's task", async () => {
    const wrongMember = database.db.insert(taskAssignees).values({
      projectId: a.projectId,
      taskId: aTask.id,
      memberId: b.creator.id,
    })
    await expect(wrongMember).rejects.toSatisfy((error) => refused(error, FOREIGN_KEY_VIOLATION))

    const wrongTask = database.db.insert(taskAssignees).values({
      projectId: a.projectId,
      taskId: bTask.id,
      memberId: a.creator.id,
    })
    await expect(wrongTask).rejects.toSatisfy((error) => refused(error, FOREIGN_KEY_VIOLATION))
  })

  it('rejects activity and note revisions that point at another project', async () => {
    const wrongTask = database.db.insert(taskActivity).values({
      projectId: a.projectId,
      taskId: bTask.id,
      memberId: a.creator.id,
      action: 'updated',
    })
    await expect(wrongTask).rejects.toSatisfy((error) => refused(error, FOREIGN_KEY_VIOLATION))

    const wrongSubject = database.db.insert(taskActivity).values({
      projectId: a.projectId,
      taskId: aTask.id,
      memberId: a.creator.id,
      subjectMemberId: b.creator.id,
      action: 'assignee_added',
    })
    await expect(wrongSubject).rejects.toSatisfy((error) => refused(error, FOREIGN_KEY_VIOLATION))

    const wrongRevision = database.db.insert(taskNoteRevisions).values({
      projectId: a.projectId,
      taskId: bTask.id,
      revisionNumber: 9,
      content: 'x',
      editorType: 'member',
      editorMemberId: a.creator.id,
      editorName: 'Ann',
    })
    await expect(wrongRevision).rejects.toSatisfy((error) => refused(error, FOREIGN_KEY_VIOLATION))
  })

  it('refuses inconsistent completion, actor and note records', async () => {
    const completeWithoutWho = database.db
      .update(tasks)
      .set({ status: 'completed' })
      .where(and(eq(tasks.id, aTask.id), eq(tasks.projectId, a.projectId)))
    await expect(completeWithoutWho).rejects.toSatisfy((error) => refused(error, CHECK_VIOLATION))

    const noAuthorAtAll = database.db.insert(tasks).values({ projectId: a.projectId, title: 'Orphan' })
    await expect(noAuthorAtAll).rejects.toSatisfy((error) => refused(error, CHECK_VIOLATION))

    const noteWithoutVersion = database.db
      .update(tasks)
      .set({ progressNote: 'sneaky' })
      .where(eq(tasks.id, aTask.id))
    await expect(noteWithoutVersion).rejects.toSatisfy((error) => refused(error, CHECK_VIOLATION))
  })

  it('refuses two members with the same name in one project, but allows it across projects', async () => {
    const duplicate = database.db.insert(members).values({ projectId: a.projectId, name: 'ann' })
    await expect(duplicate).rejects.toSatisfy((error) => refused(error, '23505'))
    expect((await b.client.post('/api/members', { body: { name: 'Ann' } })).status).toBe(201)
  })

  it('allows a person to be actively assigned to a task only once', async () => {
    const duplicate = database.db.insert(taskAssignees).values({
      projectId: a.projectId,
      taskId: aTask.id,
      memberId: a.creator.id,
    })
    await expect(duplicate).rejects.toSatisfy((error) => refused(error, '23505'))
  })
})

describe('progress is scoped to the task it belongs to', () => {
  it("cannot change a colleague's progress through another task's endpoint", async () => {
    const c = await createCollabo({ memberNames: ['Mariama'] })
    const first = await createTask(c.client, { assigneeIds: [c.creator.id, c.member('Mariama').id] })
    const second = await createTask(c.client, { assigneeIds: [c.creator.id, c.member('Mariama').id] })

    await setStatus(c.as('Mariama'), first, c.member('Mariama').id, 'in_progress')
    const secondAfter = await c.client.get<{ task: TaskDto }>(`/api/tasks/${second.id}`)
    expect(secondAfter.body.task.assignees.every((row) => row.status === 'todo')).toBe(true)
  })
})
