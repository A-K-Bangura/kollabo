import { and, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { ActivityDto, MemberDto, TaskDto } from '../../shared/types.js'
import { members, taskActivity, tasks } from '../db/schema.js'
import { pgErrorCode } from '../errors.js'
import { createCollabo, createTask, joinWithCode, type Collabo } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'

const FOREIGN_KEY_VIOLATION = '23503'

let database: TestDatabase
let a: Collabo
let b: Collabo
let aTaskId: string
let bTaskId: string
let bTitle: string

beforeAll(async () => {
  database = await createTestDatabase()
  a = await createCollabo({ name: 'Collabo A', creatorName: 'Ann', memberNames: ['Amir'] })
  b = await createCollabo({ name: 'Collabo B', creatorName: 'Bea', memberNames: ['Bo'] })
  aTaskId = (await createTask(a.client, { title: 'A secret plan' })).id
  const bTask = await createTask(b.client, { title: 'B secret plan' })
  bTaskId = bTask.id
  bTitle = bTask.title
})
afterAll(() => database.close())

describe('one Collabo can never see or touch another', () => {
  it('lists only its own tasks and members', async () => {
    const tasksA = await a.client.get<{ tasks: TaskDto[] }>('/api/tasks')
    expect(tasksA.body.tasks.map((task) => task.title)).toEqual(['A secret plan'])

    const membersA = await a.client.get<{ members: MemberDto[] }>('/api/members')
    expect(membersA.body.members.map((member) => member.name)).toEqual(['Ann', 'Amir'])

    const projectA = await a.client.get<{ project: { name: string } }>('/api/project')
    expect(projectA.body.project.name).toBe('Collabo A')
  })

  it("cannot read another Collabo's task, even knowing its id", async () => {
    for (const path of [`/api/tasks/${bTaskId}`, `/api/tasks/${bTaskId}/activity`]) {
      const result = await a.client.get<ApiErrorBody>(path)
      expect(result.status).toBe(404)
      expect(result.body.error.code).toBe('TASK_NOT_FOUND')
      expect(JSON.stringify(result.body)).not.toContain(bTitle)
    }
  })

  it("cannot edit or delete another Collabo's task", async () => {
    const edit = await a.client.patch<ApiErrorBody>(`/api/tasks/${bTaskId}`, {
      body: { expectedVersion: 1, title: 'Hijacked', status: 'completed' },
    })
    expect(edit.status).toBe(404)

    const remove = await a.client.delete<ApiErrorBody>(`/api/tasks/${bTaskId}`)
    expect(remove.status).toBe(404)

    const stillThere = await b.client.get<{ task: TaskDto }>(`/api/tasks/${bTaskId}`)
    expect(stillThere.body.task).toMatchObject({ title: bTitle, status: 'todo', version: 1 })
    const activity = await b.client.get<{ activity: ActivityDto[] }>(`/api/tasks/${bTaskId}/activity`)
    expect(activity.body.activity).toHaveLength(1)
  })

  it("cannot remove another Collabo's member", async () => {
    const bo = b.members.find((member) => member.name === 'Bo')!
    const result = await a.client.delete<ApiErrorBody>(`/api/members/${bo.id}`)
    expect(result.status).toBe(404)

    const membersB = await b.client.get<{ members: MemberDto[] }>('/api/members')
    expect(membersB.body.members.find((member) => member.id === bo.id)?.isActive).toBe(true)
  })

  it("cannot act as, or assign work to, another Collabo's members", async () => {
    const bea = b.creator

    const actingAs = await a.client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Impersonation' },
      actor: bea.id,
    })
    expect(actingAs.body.error.code).toBe('MEMBER_REQUIRED')

    const assigning = await a.client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Cross-project assignee', assignedToMemberId: bea.id },
    })
    expect(assigning.status).toBe(404)
    expect(assigning.body.error.code).toBe('MEMBER_NOT_FOUND')

    const reassigning = await a.client.patch<ApiErrorBody>(`/api/tasks/${aTaskId}`, {
      body: { expectedVersion: 1, assignedToMemberId: bea.id },
    })
    expect(reassigning.body.error.code).toBe('MEMBER_NOT_FOUND')
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

  it("ignores a project id sent by the client", async () => {
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
})

describe('the database itself refuses cross-project links', () => {
  it("rejects a task assigned to another project's member", async () => {
    const attempt = database.db.insert(tasks).values({
      projectId: a.projectId,
      title: 'Bad link',
      assignedToMemberId: b.creator.id,
      createdByMemberId: a.creator.id,
      updatedByMemberId: a.creator.id,
    })
    await expect(attempt).rejects.toSatisfy((error) => pgErrorCode(error) === FOREIGN_KEY_VIOLATION)
  })

  it("rejects a task created by another project's member", async () => {
    const attempt = database.db.insert(tasks).values({
      projectId: a.projectId,
      title: 'Bad author',
      createdByMemberId: b.creator.id,
      updatedByMemberId: b.creator.id,
    })
    await expect(attempt).rejects.toSatisfy((error) => pgErrorCode(error) === FOREIGN_KEY_VIOLATION)
  })

  it("rejects activity that points at another project's task or member", async () => {
    const wrongTask = database.db.insert(taskActivity).values({
      projectId: a.projectId,
      taskId: bTaskId,
      memberId: a.creator.id,
      action: 'updated',
    })
    await expect(wrongTask).rejects.toSatisfy((error) => pgErrorCode(error) === FOREIGN_KEY_VIOLATION)

    const wrongMember = database.db.insert(taskActivity).values({
      projectId: a.projectId,
      taskId: aTaskId,
      memberId: b.creator.id,
      action: 'updated',
    })
    await expect(wrongMember).rejects.toSatisfy((error) => pgErrorCode(error) === FOREIGN_KEY_VIOLATION)
  })

  it('refuses an inconsistent completion record', async () => {
    const attempt = database.db
      .update(tasks)
      .set({ status: 'completed' }) // completed without who/when
      .where(and(eq(tasks.id, aTaskId), eq(tasks.projectId, a.projectId)))
    await expect(attempt).rejects.toSatisfy((error) => pgErrorCode(error) === '23514')
  })

  it('refuses two members with the same name in one project, but allows it across projects', async () => {
    const duplicate = database.db.insert(members).values({ projectId: a.projectId, name: 'ann' })
    await expect(duplicate).rejects.toSatisfy((error) => pgErrorCode(error) === '23505')

    const sameNameElsewhere = await b.client.post('/api/members', { body: { name: 'Ann' } })
    expect(sameNameElsewhere.status).toBe(201)
  })
})
