import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { ActivityDto, TaskDto } from '../../shared/types.js'
import { tasks } from '../db/schema.js'
import { createCollabo, createTask, joinWithCode } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

describe('creating tasks (scenario C)', () => {
  it('creates a task for a teammate with the creator recorded and a "created" activity', async () => {
    const { client, creator, members } = await createCollabo()
    const mariama = members.find((member) => member.name === 'Mariama')!

    const task = await createTask(client, {
      title: '  Finish landing page  ',
      description: 'Hero, pricing, footer',
      assignedToMemberId: mariama.id,
      dueDate: '2026-10-10',
      priority: 'high',
    })

    expect(task).toMatchObject({
      title: 'Finish landing page',
      description: 'Hero, pricing, footer',
      status: 'todo',
      priority: 'high',
      assignedToMemberId: mariama.id,
      dueDate: '2026-10-10',
      createdByMemberId: creator.id,
      updatedByMemberId: creator.id,
      completedByMemberId: null,
      completedAt: null,
      version: 1,
    })

    const activity = await client.get<{ activity: ActivityDto[] }>(`/api/tasks/${task.id}/activity`)
    expect(activity.body.activity).toHaveLength(1)
    expect(activity.body.activity[0]).toMatchObject({
      action: 'created',
      memberId: creator.id,
      fromStatus: null,
      toStatus: null,
    })
  })

  it('defaults to todo/medium, treats a blank description as none, and keeps the due date exactly', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client, { description: '   ', dueDate: '2026-12-31' })
    expect(task.status).toBe('todo')
    expect(task.priority).toBe('medium')
    expect(task.description).toBeNull()
    // A calendar date must round-trip untouched: no timezone can move it a day.
    expect(task.dueDate).toBe('2026-12-31')

    const fetched = await client.get<{ task: TaskDto }>(`/api/tasks/${task.id}`)
    expect(fetched.body.task.dueDate).toBe('2026-12-31')
  })

  it('shows new tasks in the list, newest first', async () => {
    const { client } = await createCollabo()
    const first = await createTask(client, { title: 'First' })
    const second = await createTask(client, { title: 'Second' })

    const list = await client.get<{ tasks: TaskDto[] }>('/api/tasks')
    expect(list.body.tasks.map((task) => task.id)).toEqual([second.id, first.id])
  })

  it('needs an acting member for attribution', async () => {
    const { client, members } = await createCollabo()

    const none = await client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'No actor' },
      actor: null,
    })
    expect(none.status).toBe(400)
    expect(none.body.error.code).toBe('MEMBER_REQUIRED')

    const junk = await client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Junk actor' },
      actor: 'not-a-uuid',
    })
    expect(junk.body.error.code).toBe('MEMBER_REQUIRED')

    const unknown = await client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Unknown actor' },
      actor: '3f2b8f0c-6f6e-4a53-8f1c-1f9d5d4b9a77',
    })
    expect(unknown.body.error.code).toBe('MEMBER_REQUIRED')

    // Any real member can act; the access code is the gate, not the member.
    const ibrahim = members.find((member) => member.name === 'Ibrahim')!
    const ok = await client.post('/api/tasks', { body: { title: 'As Ibrahim' }, actor: ibrahim.id })
    expect(ok.status).toBe(201)
  })

  it('validates every field on the server', async () => {
    const { client } = await createCollabo()
    const invalid: Record<string, unknown>[] = [
      { title: '' },
      { title: '   ' },
      { title: 'x'.repeat(121) },
      { title: 'ok', description: 'x'.repeat(2001) },
      { title: 'ok', dueDate: '2026-02-30' },
      { title: 'ok', dueDate: '10/10/2026' },
      { title: 'ok', dueDate: '2026-10-10T09:00:00Z' },
      { title: 'ok', priority: 'urgent' },
      { title: 'ok', assignedToMemberId: 'someone' },
      {},
    ]
    for (const body of invalid) {
      const result = await client.post<ApiErrorBody>('/api/tasks', { body })
      expect(result.status, JSON.stringify(body)).toBe(400)
      expect(result.body.error.code).toBe('VALIDATION_ERROR')
    }

    const malformed = await client.post<ApiErrorBody>('/api/tasks', { rawBody: '{nope' })
    expect(malformed.status).toBe(400)
  })

  it('ignores any project id or status the client tries to force', async () => {
    const { client, projectId } = await createCollabo()
    const other = await createCollabo()

    const result = await client.post<{ task: TaskDto }>('/api/tasks', {
      body: {
        title: 'Sneaky',
        projectId: other.projectId,
        status: 'completed',
        completedByMemberId: other.creator.id,
      },
    })
    expect(result.status).toBe(201)
    expect(result.body.task.status).toBe('todo')

    const [row] = await database.db.select().from(tasks).where(eq(tasks.id, result.body.task.id))
    expect(row?.projectId).toBe(projectId)
  })
})

describe('working on tasks (scenarios D and E)', () => {
  it('records each status change with who made it, and completion details', async () => {
    const { client: alhaji, code, members } = await createCollabo()
    const mariamaMember = members.find((member) => member.name === 'Mariama')!
    const task = await createTask(alhaji, { assignedToMemberId: mariamaMember.id })

    const mariama = await joinWithCode(code)
    mariama.memberId = mariamaMember.id

    const started = await mariama.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: task.version, status: 'in_progress' },
    })
    expect(started.status).toBe(200)
    expect(started.body.task).toMatchObject({
      status: 'in_progress',
      version: 2,
      updatedByMemberId: mariamaMember.id,
      completedByMemberId: null,
      completedAt: null,
    })

    const finished = await mariama.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 2, status: 'completed' },
    })
    expect(finished.body.task).toMatchObject({
      status: 'completed',
      version: 3,
      completedByMemberId: mariamaMember.id,
    })
    expect(finished.body.task.completedAt).toEqual(expect.any(String))

    const activity = await alhaji.get<{ activity: ActivityDto[] }>(`/api/tasks/${task.id}/activity`)
    expect(
      activity.body.activity.map(({ action, fromStatus, toStatus, memberId }) => ({
        action,
        fromStatus,
        toStatus,
        memberId,
      })),
    ).toEqual([
      { action: 'created', fromStatus: null, toStatus: null, memberId: alhaji.memberId },
      { action: 'status_changed', fromStatus: 'todo', toStatus: 'in_progress', memberId: mariamaMember.id },
      { action: 'status_changed', fromStatus: 'in_progress', toStatus: 'completed', memberId: mariamaMember.id },
    ])
  })

  it('clears completion details when a task is reopened', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client)
    const done = await client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, status: 'completed' },
    })
    expect(done.body.task.completedAt).not.toBeNull()

    const reopened = await client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 2, status: 'todo' },
    })
    expect(reopened.body.task).toMatchObject({
      status: 'todo',
      completedAt: null,
      completedByMemberId: null,
    })
  })

  it('logs edits as "updated", and a combined edit and status change as two entries', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client)

    const edited = await client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, title: 'Renamed', priority: 'low', dueDate: null },
    })
    expect(edited.body.task).toMatchObject({ title: 'Renamed', priority: 'low', version: 2 })

    await client.patch(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 2, description: 'More detail', status: 'in_progress' },
    })

    const activity = await client.get<{ activity: ActivityDto[] }>(`/api/tasks/${task.id}/activity`)
    expect(activity.body.activity.map((entry) => entry.action)).toEqual([
      'created',
      'updated',
      'updated',
      'status_changed',
    ])
  })

  it('leaves no trace and keeps the version when a save changes nothing', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client, { title: 'Same' })

    const result = await client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, title: 'Same', status: 'todo' },
    })
    expect(result.status).toBe(200)
    expect(result.body.task.version).toBe(1)

    const activity = await client.get<{ activity: ActivityDto[] }>(`/api/tasks/${task.id}/activity`)
    expect(activity.body.activity).toHaveLength(1)
  })

  it('shows teammates changes only after they fetch again (no push, no polling)', async () => {
    const { client: alhaji, code } = await createCollabo()
    const ibrahim = await joinWithCode(code)
    const task = await createTask(alhaji)

    const before = await ibrahim.get<{ tasks: TaskDto[] }>('/api/tasks')
    await alhaji.patch(`/api/tasks/${task.id}`, { body: { expectedVersion: 1, status: 'completed' } })

    // What Ibrahim already loaded is unchanged; only his next explicit fetch shows it.
    expect(before.body.tasks[0]?.status).toBe('todo')
    const after = await ibrahim.get<{ tasks: TaskDto[] }>('/api/tasks')
    expect(after.body.tasks[0]?.status).toBe('completed')
  })

  it('requires the version the editor loaded and an acting member', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client)

    const noVersion = await client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { title: 'No version' },
    })
    expect(noVersion.status).toBe(400)

    const empty = await client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1 },
    })
    expect(empty.status).toBe(400)

    const noActor = await client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, title: 'Anonymous' },
      actor: null,
    })
    expect(noActor.body.error.code).toBe('MEMBER_REQUIRED')

    const badStatus = await client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, status: 'archived' },
    })
    expect(badStatus.status).toBe(400)
  })
})

describe('stale edits (scenario F)', () => {
  it('rejects a stale save with 409 and never overwrites the newer change', async () => {
    const { client: alhaji, code, members } = await createCollabo()
    const task = await createTask(alhaji, { title: 'Original' })

    // Alhaji has the task open at version 1. Mariama changes it first.
    const mariama = await joinWithCode(code)
    mariama.memberId = members.find((member) => member.name === 'Mariama')!.id
    await mariama.patch(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, status: 'in_progress', title: 'Mariama was here' },
    })

    const stale = await alhaji.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, title: "Alhaji's overwrite" },
    })
    expect(stale.status).toBe(409)
    expect(stale.body.error).toMatchObject({
      code: 'TASK_CONFLICT',
      message: 'This task has changed since you last refreshed. Refresh it before editing.',
    })

    const current = await alhaji.get<{ task: TaskDto }>(`/api/tasks/${task.id}`)
    expect(current.body.task).toMatchObject({ title: 'Mariama was here', status: 'in_progress', version: 2 })

    // After refreshing, Alhaji can edit using the new version.
    const retry = await alhaji.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: current.body.task.version, title: "Alhaji's edit" },
    })
    expect(retry.status).toBe(200)
    expect(retry.body.task.version).toBe(3)
  })

  it('lets exactly one of two simultaneous saves win', async () => {
    const { client, code } = await createCollabo()
    const other = await joinWithCode(code)
    const task = await createTask(client)

    const results = await Promise.all([
      client.patch(`/api/tasks/${task.id}`, { body: { expectedVersion: 1, title: 'From A' } }),
      other.patch(`/api/tasks/${task.id}`, {
        body: { expectedVersion: 1, title: 'From B' },
        actor: client.memberId,
      }),
    ])
    expect(results.map((result) => result.status).sort()).toEqual([200, 409])

    const activity = await client.get<{ activity: ActivityDto[] }>(`/api/tasks/${task.id}/activity`)
    expect(activity.body.activity.filter((entry) => entry.action === 'updated')).toHaveLength(1)
  })

  it('also protects quick status changes made from a stale list', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client)
    await client.patch(`/api/tasks/${task.id}`, { body: { expectedVersion: 1, status: 'completed' } })

    const stale = await client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, status: 'in_progress' },
    })
    expect(stale.status).toBe(409)
  })
})

describe('deleting tasks', () => {
  it('removes the task and its history', async () => {
    const { client } = await createCollabo()
    const task = await createTask(client)

    expect((await client.delete(`/api/tasks/${task.id}`)).status).toBe(204)
    expect((await client.get(`/api/tasks/${task.id}`)).status).toBe(404)
    const activity = await client.get<ApiErrorBody>(`/api/tasks/${task.id}/activity`)
    expect(activity.body.error.code).toBe('TASK_NOT_FOUND')
    expect((await client.delete(`/api/tasks/${task.id}`)).status).toBe(404)
  })

  it('returns 400 for a malformed id and 404 for an unknown one', async () => {
    const { client } = await createCollabo()
    expect((await client.get('/api/tasks/not-a-uuid')).status).toBe(400)
    expect((await client.get('/api/tasks/3f2b8f0c-6f6e-4a53-8f1c-1f9d5d4b9a77')).status).toBe(404)
  })
})
