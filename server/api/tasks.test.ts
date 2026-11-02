import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { TaskDto } from '../../shared/types.js'
import { taskAssignees, tasks } from '../db/schema.js'
import { createCollabo, createTask } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { activityOf, describeActivity, fetchTask } from '../test/helpers.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

describe('creating tasks (scenario C)', () => {
  it('creates a task for several people with the creator recorded and a full history', async () => {
    const { client, creator, member } = await createCollabo()
    const mariama = member('Mariama')
    const ibrahim = member('Ibrahim')

    const task = await createTask(client, {
      title: '  Finish landing page  ',
      description: 'Hero, pricing, footer',
      assigneeIds: [mariama.id, ibrahim.id],
      dueDate: '2026-10-10',
      priority: 'high',
    })

    expect(task).toMatchObject({
      title: 'Finish landing page',
      description: 'Hero, pricing, footer',
      status: 'todo',
      priority: 'high',
      assignmentMode: 'all',
      dueDate: '2026-10-10',
      createdByMemberId: creator.id,
      updatedByMemberId: creator.id,
      completedByMemberId: null,
      completedAt: null,
      progressNote: null,
      progressNoteVersion: 0,
      version: 1,
    })
    expect(task.createdBy).toEqual({ type: 'member', memberId: creator.id, name: 'Alhaji' })
    expect(task.assignees.map((row) => [row.memberId, row.status, row.version])).toEqual([
      [mariama.id, 'todo', 1],
      [ibrahim.id, 'todo', 1],
    ])
    // The V1 single-assignee field still answers, with the first assignee.
    expect(task.assignedToMemberId).toBe(mariama.id)

    expect(describeActivity(await activityOf(client, task.id))).toEqual([
      'created',
      'assignee_added:Mariama',
      'assignee_added:Ibrahim',
    ])
  })

  it('accepts the V1 single-assignee field', async () => {
    const { client, member } = await createCollabo()
    const task = await createTask(client, { assignedToMemberId: member('Mariama').id })
    expect(task.assignees.map((row) => row.memberId)).toEqual([member('Mariama').id])
  })

  it('requires at least one active assignee from this project', async () => {
    const { client, member, projectId } = await createCollabo()
    const other = await createCollabo()

    for (const body of [
      { title: 'Nobody' },
      { title: 'Nobody', assigneeIds: [] },
      { title: 'Nobody', assigneeIds: null },
    ]) {
      const result = await client.post<ApiErrorBody>('/api/tasks', { body })
      expect(result.status, JSON.stringify(body)).toBe(400)
      expect(result.body.error.code).toBe('VALIDATION_ERROR')
    }

    const foreign = await client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Cross project', assigneeIds: [other.creator.id] },
    })
    expect(foreign.status).toBe(404)
    expect(foreign.body.error.code).toBe('MEMBER_NOT_FOUND')

    await client.delete(`/api/members/${member('Ibrahim').id}`)
    const inactive = await client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Gone', assigneeIds: [member('Ibrahim').id] },
    })
    expect(inactive.body.error.code).toBe('MEMBER_NOT_FOUND')

    // Nothing was created by any of the refusals.
    const rows = await database.db.select().from(tasks).where(eq(tasks.projectId, projectId))
    expect(rows).toHaveLength(0)
  })

  it('ignores duplicate assignees and the same person listed twice', async () => {
    const { client, creator } = await createCollabo()
    const task = await createTask(client, { assigneeIds: [creator.id, creator.id] })
    expect(task.assignees).toHaveLength(1)
  })

  it('defaults to todo/medium/ALL and keeps a due date exactly', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client, { description: '   ', dueDate: '2026-12-31' })
    expect(task).toMatchObject({ status: 'todo', priority: 'medium', assignmentMode: 'all', description: null })
    expect(task.dueDate).toBe('2026-12-31')
    expect((await fetchTask(client, task.id)).dueDate).toBe('2026-12-31')
  })

  it('lists tasks with their assignees, newest first', async () => {
    const { client } = await createCollabo()
    const first = await createTask(client, { title: 'First' })
    const second = await createTask(client, { title: 'Second' })
    const list = await client.get<{ tasks: TaskDto[] }>('/api/tasks')
    expect(list.body.tasks.map((task) => task.id)).toEqual([second.id, first.id])
    expect(list.body.tasks.every((task) => task.assignees.length === 1)).toBe(true)
  })

  it('needs an acting member for attribution', async () => {
    const { client, member, creator } = await createCollabo()
    const body = { title: 'Needs actor', assigneeIds: [creator.id] }

    for (const actor of [null, 'not-a-uuid', '3f2b8f0c-6f6e-4a53-8f1c-1f9d5d4b9a77']) {
      const result = await client.post<ApiErrorBody>('/api/tasks', { body, actor })
      expect(result.status).toBe(400)
      expect(result.body.error.code).toBe('MEMBER_REQUIRED')
    }
    const ok = await client.post('/api/tasks', { body, actor: member('Ibrahim').id })
    expect(ok.status).toBe(201)
  })

  it('validates every field on the server', async () => {
    const { client, creator } = await createCollabo()
    const base = { assigneeIds: [creator.id] }
    const invalid: Record<string, unknown>[] = [
      { title: '' },
      { title: '   ' },
      { title: 'x'.repeat(121) },
      { title: 'ok', description: 'x'.repeat(2001) },
      { title: 'ok', dueDate: '2026-02-30' },
      { title: 'ok', dueDate: '10/10/2026' },
      { title: 'ok', dueDate: '2026-10-10T09:00:00Z' },
      { title: 'ok', priority: 'urgent' },
      { title: 'ok', assignmentMode: 'some' },
      { title: 'ok', assigneeIds: ['someone'] },
      {},
    ]
    for (const extra of invalid) {
      const result = await client.post<ApiErrorBody>('/api/tasks', { body: { ...base, ...extra } })
      expect(result.status, JSON.stringify(extra)).toBe(400)
      expect(result.body.error.code).toBe('VALIDATION_ERROR')
    }
    expect((await client.post('/api/tasks', { rawBody: '{nope' })).status).toBe(400)
  })

  it('ignores any project id, status or completion the client tries to force', async () => {
    const { client, projectId, creator } = await createCollabo()
    const other = await createCollabo()

    const result = await client.post<{ task: TaskDto }>('/api/tasks', {
      body: {
        title: 'Sneaky',
        assigneeIds: [creator.id],
        projectId: other.projectId,
        status: 'completed',
        completedByMemberId: other.creator.id,
        version: 99,
      },
    })
    expect(result.status).toBe(201)
    expect(result.body.task).toMatchObject({ status: 'todo', version: 1, completedAt: null })
    const [row] = await database.db.select().from(tasks).where(eq(tasks.id, result.body.task.id))
    expect(row?.projectId).toBe(projectId)
  })
})

describe('editing task details', () => {
  it('logs an edit as "updated" and bumps the version', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client)
    const edited = await client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, title: 'Renamed', priority: 'low', dueDate: null },
    })
    expect(edited.body.task).toMatchObject({ title: 'Renamed', priority: 'low', dueDate: null, version: 2 })
    expect(describeActivity(await activityOf(client, task.id)).at(-1)).toBe('updated')
  })

  it('records which details changed (never their text) and where a deadline moved, for future reminders', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client, { title: 'Secret title', dueDate: '2026-10-10' })
    await client.patch(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, dueDate: '2026-10-12', description: 'Confidential details' },
    })
    await client.patch(`/api/tasks/${task.id}`, { body: { expectedVersion: 2, title: 'Another title' } })

    const updates = (await activityOf(client, task.id)).filter((entry) => entry.action === 'updated')
    expect(updates[0]?.details).toEqual({
      changed: ['description', 'dueDate'],
      dueDate: { from: '2026-10-10', to: '2026-10-12' },
    })
    expect(updates[1]?.details).toEqual({ changed: ['title'] })
    expect(JSON.stringify(updates)).not.toMatch(/Secret title|Confidential|Another title/)
  })

  it('leaves no trace and keeps the version when a save changes nothing', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client, { title: 'Same' })
    const result = await client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, title: 'Same' },
    })
    expect(result.status).toBe(200)
    expect(result.body.task.version).toBe(1)
    expect(await activityOf(client, task.id)).toHaveLength(2) // created + assignee_added
  })

  it("no longer sets the task's status directly: status follows the assignees", async () => {
    const { client } = await createCollabo()
    const task = await createTask(client)
    const result = await client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, status: 'completed' },
    })
    expect(result.status).toBe(400)
    expect(result.body.error.message).toMatch(/follows its assignees/)
    expect((await fetchTask(client, task.id)).status).toBe('todo')
  })

  it('requires the version the editor loaded, something to change, and an acting member', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client)
    const url = `/api/tasks/${task.id}`
    expect((await client.patch(url, { body: { title: 'No version' } })).status).toBe(400)
    expect((await client.patch(url, { body: { expectedVersion: 1 } })).status).toBe(400)
    const noActor = await client.patch<ApiErrorBody>(url, {
      body: { expectedVersion: 1, title: 'Anonymous' },
      actor: null,
    })
    expect(noActor.body.error.code).toBe('MEMBER_REQUIRED')
  })
})

describe('stale edits (scenario F)', () => {
  it('rejects a stale save with 409 and never overwrites the newer change', async () => {
    const { client: alhaji, as } = await createCollabo()
    const task = await createTask(alhaji, { title: 'Original' })

    // Alhaji has the task open at version 1. Mariama changes it first.
    const mariama = as('Mariama')
    await mariama.patch(`/api/tasks/${task.id}`, { body: { expectedVersion: 1, title: 'Mariama was here' } })

    const stale = await alhaji.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, title: "Alhaji's overwrite" },
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({
      code: 'TASK_CONFLICT',
      message: 'This task has changed since you last refreshed. Refresh it before editing.',
    })

    const current = await fetchTask(alhaji, task.id)
    expect(current).toMatchObject({ title: 'Mariama was here', version: 2 })

    const retry = await alhaji.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: current.version, title: "Alhaji's edit" },
    })
    expect(retry.status).toBe(200)
    expect(retry.body.task.version).toBe(3)
  })

  it('lets exactly one of two simultaneous saves win', async () => {
    const { client, as } = await createCollabo()
    const other = as('Ibrahim')
    const task = await createTask(client)

    const results = await Promise.all([
      client.patch(`/api/tasks/${task.id}`, { body: { expectedVersion: 1, title: 'From A' } }),
      other.patch(`/api/tasks/${task.id}`, { body: { expectedVersion: 1, title: 'From B' } }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])
    const updates = (await activityOf(client, task.id)).filter((entry) => entry.action === 'updated')
    expect(updates).toHaveLength(1)
  })

  it('also guards an edit made from a list that is stale because someone else made progress', async () => {
    const { client, creator, as, member } = await createCollabo()
    const task = await createTask(client, { assigneeIds: [creator.id, member('Mariama').id] })
    const mariama = as('Mariama')
    await mariama.put(`/api/tasks/${task.id}/assignees/${member('Mariama').id}/status`, {
      body: { status: 'in_progress', expectedAssigneeVersion: 1 },
    })
    const stale = await client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: task.version, title: 'Too late' },
    })
    expect(stale.status).toBe(409)
  })
})

describe('deleting tasks', () => {
  it('removes the task, its assignments and its history', async () => {
    const { client, projectId } = await createCollabo()
    const task = await createTask(client)

    expect((await client.delete(`/api/tasks/${task.id}`)).status).toBe(204)
    expect((await client.get(`/api/tasks/${task.id}`)).status).toBe(404)
    const activity = await client.get<ApiErrorBody>(`/api/tasks/${task.id}/activity`)
    expect(activity.body.error.code).toBe('TASK_NOT_FOUND')
    expect((await client.delete(`/api/tasks/${task.id}`)).status).toBe(404)
    expect(
      await database.db.select().from(taskAssignees).where(eq(taskAssignees.projectId, projectId)),
    ).toHaveLength(0)
  })

  it('returns 400 for a malformed id and 404 for an unknown one', async () => {
    const { client } = await createCollabo()
    expect((await client.get('/api/tasks/not-a-uuid')).status).toBe(400)
    expect((await client.get('/api/tasks/3f2b8f0c-6f6e-4a53-8f1c-1f9d5d4b9a77')).status).toBe(404)
  })
})
