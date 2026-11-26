import { and, eq, isNotNull } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { TaskDto } from '../../shared/types.js'
import { taskAssignees } from '../db/schema.js'
import { createCollabo, createTask, type Collabo } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { activityOf, assignee, describeActivity, fetchTask, setStatus } from '../test/helpers.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

async function team(): Promise<Collabo> {
  return createCollabo({ memberNames: ['Mariama', 'Ibrahim', 'Fatima'] })
}

/** A task assigned to Alhaji, Mariama and Ibrahim. */
async function sharedTask(collabo: Collabo, assignmentMode: 'all' | 'any') {
  return createTask(collabo.client, {
    assigneeIds: [collabo.creator.id, collabo.member('Mariama').id, collabo.member('Ibrahim').id],
    assignmentMode,
  })
}

describe('ALL: everyone completes their own part', () => {
  it('is completed only when every assignee has completed, and each part is tracked separately', async () => {
    const c = await team()
    const [alhaji, mariama, ibrahim] = [c.client, c.as('Mariama'), c.as('Ibrahim')]
    let task = await sharedTask(c, 'all')

    let result = await setStatus(mariama, task, c.member('Mariama').id, 'in_progress')
    task = result.body.task
    expect(task.status).toBe('in_progress')
    expect(task.assignees.map((row) => row.status)).toEqual(['todo', 'in_progress', 'todo'])

    result = await setStatus(mariama, task, c.member('Mariama').id, 'completed')
    task = result.body.task
    expect(task.status).toBe('in_progress') // 1 of 3
    expect(task.completedAt).toBeNull()

    result = await setStatus(alhaji, task, c.creator.id, 'completed')
    task = result.body.task
    expect(task.status).toBe('in_progress') // 2 of 3
    expect(task.assignees.filter((row) => row.status === 'completed')).toHaveLength(2)

    result = await setStatus(ibrahim, task, c.member('Ibrahim').id, 'completed')
    task = result.body.task
    expect(task.status).toBe('completed') // 3 of 3
    expect(task.completedBy).toEqual({ type: 'member', memberId: c.member('Ibrahim').id, name: 'Ibrahim' })
    expect(task.completedAt).not.toBeNull()
    // Everyone's own completion is still recorded.
    expect(task.assignees.every((row) => row.status === 'completed' && row.completedAt)).toBe(true)

    expect(describeActivity(await activityOf(alhaji, task.id)).slice(4)).toEqual([
      'assignee_status_changed:Mariama todo>in_progress',
      'status_changed todo>in_progress',
      'assignee_status_changed:Mariama in_progress>completed',
      'assignee_status_changed:Alhaji todo>completed',
      'assignee_status_changed:Ibrahim todo>completed',
      'status_changed in_progress>completed',
    ])
  })

  it('lets people change only their own progress', async () => {
    const c = await team()
    const task = await sharedTask(c, 'all')
    const mariama = c.as('Mariama')

    const others = await setStatus(mariama, task, c.creator.id, 'completed')
    expect(others.status).toBe(403)
    expect((others.body as unknown as ApiErrorBody).error.code).toBe('NOT_ASSIGNED')

    // Someone not on the task cannot make progress on it either.
    const fatima = c.as('Fatima')
    const outsider = await setStatus(fatima, task, c.member('Fatima').id, 'in_progress')
    expect(outsider.status).toBe(404)

    expect((await fetchTask(c.client, task.id)).assignees.every((row) => row.status === 'todo')).toBe(true)
  })

  it("does not conflict with other people's progress, but a stale view of your own does", async () => {
    const c = await team()
    const task = await sharedTask(c, 'all')
    const [mariama, ibrahim] = [c.as('Mariama'), c.as('Ibrahim')]

    // Both load the task at the same moment.
    await setStatus(ibrahim, task, c.member('Ibrahim').id, 'in_progress')
    const mine = await setStatus(mariama, task, c.member('Mariama').id, 'in_progress')
    expect(mine.status).toBe(200) // Ibrahim's change did not make Mariama's view stale for her own row

    const stale = await setStatus(mariama, task, c.member('Mariama').id, 'completed') // still using version 1
    expect(stale.status).toBe(409)
    expect((stale.body as unknown as ApiErrorBody).error.code).toBe('ASSIGNEE_CONFLICT')
    expect(assignee(await fetchTask(c.client, task.id), c.member('Mariama').id).status).toBe('in_progress')
  })

  it('applies two simultaneous completions once: one completion, one history entry', async () => {
    const c = await team()
    const task = await createTask(c.client, {
      assigneeIds: [c.member('Mariama').id, c.member('Ibrahim').id],
    })
    const results = await Promise.all([
      setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed'),
      setStatus(c.as('Ibrahim'), task, c.member('Ibrahim').id, 'completed'),
    ])
    expect(results.map((result) => result.status)).toEqual([200, 200])

    const final = await fetchTask(c.client, task.id)
    expect(final.status).toBe('completed')
    const completions = (await activityOf(c.client, task.id)).filter(
      (entry) => entry.action === 'status_changed' && entry.toStatus === 'completed',
    )
    expect(completions).toHaveLength(1)
  })

  it('reopening your own part reopens the task and clears its completion', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.member('Mariama').id, c.member('Ibrahim').id] })
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task
    task = (await setStatus(c.as('Ibrahim'), task, c.member('Ibrahim').id, 'completed')).body.task
    expect(task.status).toBe('completed')

    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress')).body.task
    expect(task).toMatchObject({ status: 'in_progress', completedAt: null, completedBy: null })
    expect(assignee(task, c.member('Mariama').id)).toMatchObject({ status: 'in_progress', completedAt: null })
    expect(assignee(task, c.member('Ibrahim').id).status).toBe('completed') // untouched
  })

  it('reopens a completed task when an unfinished person is added, and completes it when the last unfinished one is removed', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.member('Mariama').id] })
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task
    expect(task.status).toBe('completed')

    const added = await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: task.version, assigneeIds: [c.member('Mariama').id, c.member('Fatima').id] },
    })
    task = added.body.task
    expect(task).toMatchObject({ status: 'in_progress', completedAt: null })
    expect(task.assignees.map((row) => row.status)).toEqual(['completed', 'todo'])

    const removed = await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: task.version, assigneeIds: [c.member('Mariama').id] },
    })
    expect(removed.body.task.status).toBe('completed')
    expect(removed.body.task.completedAt).not.toBeNull()

    const history = describeActivity(await activityOf(c.client, task.id))
    expect(history).toContain('assignee_added:Fatima')
    expect(history).toContain('assignee_removed:Fatima')
    expect(history.filter((entry) => entry === 'status_changed completed>in_progress')).toHaveLength(1)
  })

  it('keeps a removed assignee as history, and a re-added one starts fresh', async () => {
    const c = await team()
    let task = await createTask(c.client, {
      assigneeIds: [c.creator.id, c.member('Mariama').id],
    })
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress')).body.task

    task = (
      await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
        body: { expectedVersion: task.version, assigneeIds: [c.creator.id] },
      })
    ).body.task
    expect(task.assignees.map((row) => row.memberId)).toEqual([c.creator.id])
    expect(task.status).toBe('todo') // Mariama's progress no longer counts

    task = (
      await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
        body: { expectedVersion: task.version, assigneeIds: [c.creator.id, c.member('Mariama').id] },
      })
    ).body.task
    expect(assignee(task, c.member('Mariama').id)).toMatchObject({ status: 'todo', version: 1 })

    const rows = await database.db
      .select()
      .from(taskAssignees)
      .where(and(eq(taskAssignees.taskId, task.id), eq(taskAssignees.memberId, c.member('Mariama').id)))
    expect(rows).toHaveLength(2) // the earlier stint is still there
    expect(rows.filter((row) => row.removedAt !== null)).toHaveLength(1)
    expect(rows.find((row) => row.removedAt !== null)?.status).toBe('in_progress')
  })

  it('never allows a task with nobody on it', async () => {
    const c = await team()
    const task = await createTask(c.client)
    const result = await c.client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, assigneeIds: [] },
    })
    expect(result.status).toBe(400)
    expect((await fetchTask(c.client, task.id)).assignees).toHaveLength(1)
  })
})

describe('ANY: one person completes it for the group', () => {
  it('lets people progress separately, and one completion ends the task for everyone', async () => {
    const c = await team()
    let task = await sharedTask(c, 'any')
    const [mariama, ibrahim] = [c.as('Mariama'), c.as('Ibrahim')]

    task = (await setStatus(ibrahim, task, c.member('Ibrahim').id, 'in_progress')).body.task
    expect(task.status).toBe('in_progress')

    task = (await setStatus(mariama, task, c.member('Mariama').id, 'completed')).body.task
    expect(task.status).toBe('completed')
    expect(task.completedBy).toEqual({ type: 'member', memberId: c.member('Mariama').id, name: 'Mariama' })
    expect(task.completedAt).not.toBeNull()

    // Nobody else is falsely marked as having completed their part.
    expect(assignee(task, c.member('Mariama').id).status).toBe('completed')
    expect(assignee(task, c.member('Ibrahim').id).status).toBe('in_progress')
    expect(assignee(task, c.creator.id).status).toBe('todo')

    const history = describeActivity(await activityOf(c.client, task.id))
    expect(history.slice(-4)).toEqual([
      'assignee_status_changed:Ibrahim todo>in_progress',
      'status_changed todo>in_progress',
      'assignee_status_changed:Mariama todo>completed',
      'status_changed in_progress>completed',
    ])
    const groupCompletion = (await activityOf(c.client, task.id)).at(-1)
    expect(groupCompletion).toMatchObject({
      action: 'status_changed',
      details: { trigger: 'group_completion' },
      actor: { name: 'Mariama' },
    })
  })

  it('does not reopen implicitly: nobody changes progress once it is completed', async () => {
    const c = await team()
    let task = await sharedTask(c, 'any')
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task

    const blocked = await setStatus(c.as('Ibrahim'), task, c.member('Ibrahim').id, 'in_progress')
    expect(blocked.status).toBe(409)
    expect((blocked.body as unknown as ApiErrorBody).error.code).toBe('TASK_COMPLETED')

    const own = await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress')
    expect(own.status).toBe(409)
    expect((await fetchTask(c.client, task.id)).status).toBe('completed')
  })

  it('reopens only through an explicit action by an assignee, and keeps the history', async () => {
    const c = await team()
    let task = await sharedTask(c, 'any')
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task

    const outsider = await c.as('Fatima').post<ApiErrorBody>(`/api/tasks/${task.id}/reopen`, {
      body: { expectedVersion: task.version },
    })
    expect(outsider.status).toBe(403)

    const stale = await c.as('Ibrahim').post<ApiErrorBody>(`/api/tasks/${task.id}/reopen`, {
      body: { expectedVersion: task.version - 1 },
    })
    expect(stale.status).toBe(409)

    const reopened = await c.as('Ibrahim').post<{ task: TaskDto }>(`/api/tasks/${task.id}/reopen`, {
      body: { expectedVersion: task.version },
    })
    expect(reopened.status).toBe(200)
    task = reopened.body.task
    expect(task).toMatchObject({ status: 'in_progress', completedAt: null, completedBy: null })
    // The completer goes back to in progress; everyone else's state is untouched.
    expect(assignee(task, c.member('Mariama').id)).toMatchObject({ status: 'in_progress', completedAt: null })
    expect(assignee(task, c.creator.id).status).toBe('todo')

    // The completion is still in the activity log, followed by the reopening.
    const history = await activityOf(c.client, task.id)
    expect(history.some((entry) => entry.details?.trigger === 'group_completion')).toBe(true)
    expect(history.at(-1)).toMatchObject({
      action: 'status_changed',
      fromStatus: 'completed',
      toStatus: 'in_progress',
      details: { trigger: 'reopened' },
      actor: { name: 'Ibrahim' },
    })

    // And it can be completed again, giving a second completion event.
    task = (await setStatus(c.as('Ibrahim'), task, c.member('Ibrahim').id, 'completed')).body.task
    expect(task).toMatchObject({ status: 'completed', completedBy: { name: 'Ibrahim' } })
    const completions = (await activityOf(c.client, task.id)).filter(
      (entry) => entry.details?.trigger === 'group_completion',
    )
    expect(completions).toHaveLength(2)
  })

  it('has nothing to reopen on an open task or on an ALL task', async () => {
    const c = await team()
    const open = await sharedTask(c, 'any')
    const notCompleted = await c.client.post<ApiErrorBody>(`/api/tasks/${open.id}/reopen`, {
      body: { expectedVersion: open.version },
    })
    expect(notCompleted.status).toBe(422)
    expect(notCompleted.body.error.code).toBe('REOPEN_NOT_APPLICABLE')

    let everyone = await createTask(c.client, { assigneeIds: [c.creator.id], assignmentMode: 'all' })
    everyone = (await setStatus(c.client, everyone, c.creator.id, 'completed')).body.task
    const all = await c.client.post<ApiErrorBody>(`/api/tasks/${everyone.id}/reopen`, {
      body: { expectedVersion: everyone.version },
    })
    expect(all.status).toBe(422)
  })

  it('stays completed through assignee changes: only an explicit reopen reopens it', async () => {
    const c = await team()
    let task = await sharedTask(c, 'any')
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task

    // A new, unfinished person is added...
    task = (
      await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
        body: {
          expectedVersion: task.version,
          assigneeIds: [c.creator.id, c.member('Mariama').id, c.member('Ibrahim').id, c.member('Fatima').id],
        },
      })
    ).body.task
    expect(task.status).toBe('completed')

    // ...and the person who completed it is removed.
    task = (
      await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
        body: { expectedVersion: task.version, assigneeIds: [c.creator.id, c.member('Ibrahim').id] },
      })
    ).body.task
    expect(task.status).toBe('completed')
    expect(task.completedBy?.name).toBe('Mariama')
  })
})

describe('switching between ALL and ANY', () => {
  it('needs no confirmation while nothing has started, and is logged', async () => {
    const c = await team()
    const task = await sharedTask(c, 'all')
    const result = await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: task.version, assignmentMode: 'any' },
    })
    expect(result.status).toBe(200)
    expect(result.body.task.assignmentMode).toBe('any')

    const change = (await activityOf(c.client, task.id)).find((entry) => entry.action === 'mode_changed')
    expect(change?.details).toEqual({ fromMode: 'all', toMode: 'any' })
  })

  it('needs confirmation once there is progress, and changes nothing without it', async () => {
    const c = await team()
    let task = await sharedTask(c, 'all')
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress')).body.task

    const refused = await c.client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: task.version, assignmentMode: 'any' },
    })
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('MODE_CHANGE_NEEDS_CONFIRMATION')
    expect(refused.body.error.details).toMatchObject({ fromMode: 'all', toMode: 'any' })
    expect(await fetchTask(c.client, task.id)).toMatchObject({ assignmentMode: 'all', version: task.version })

    const confirmed = await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: task.version, assignmentMode: 'any', confirmModeChange: true },
    })
    expect(confirmed.status).toBe(200)
    expect(confirmed.body.task.assignmentMode).toBe('any')
  })

  it('ALL -> ANY keeps work already completed: the task becomes completed by that person', async () => {
    const c = await team()
    let task = await sharedTask(c, 'all')
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task
    expect(task.status).toBe('in_progress')
    const completedAt = assignee(task, c.member('Mariama').id).completedAt

    task = (
      await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
        body: { expectedVersion: task.version, assignmentMode: 'any', confirmModeChange: true },
      })
    ).body.task
    expect(task.status).toBe('completed')
    expect(task.completedBy?.name).toBe('Mariama')
    expect(task.completedAt).toBe(completedAt)
    // Others' own states are not rewritten.
    expect(assignee(task, c.creator.id).status).toBe('todo')

    const change = (await activityOf(c.client, task.id)).filter((entry) => entry.action === 'status_changed').at(-1)
    expect(change).toMatchObject({ fromStatus: 'in_progress', toStatus: 'completed', details: { trigger: 'mode_changed' } })
  })

  it('ANY -> ALL counts only people who explicitly completed', async () => {
    const c = await team()
    let task = await sharedTask(c, 'any')
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task
    expect(task.status).toBe('completed')

    task = (
      await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
        body: { expectedVersion: task.version, assignmentMode: 'all', confirmModeChange: true },
      })
    ).body.task
    expect(task).toMatchObject({ assignmentMode: 'all', status: 'in_progress', completedAt: null, completedBy: null })
    expect(assignee(task, c.member('Mariama').id).status).toBe('completed') // preserved
    expect(assignee(task, c.creator.id).status).toBe('todo')
  })

  it('ANY -> ALL stays completed when everyone had in fact completed', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.creator.id], assignmentMode: 'any' })
    task = (await setStatus(c.client, task, c.creator.id, 'completed')).body.task
    task = (
      await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
        body: { expectedVersion: task.version, assignmentMode: 'all', confirmModeChange: true },
      })
    ).body.task
    expect(task.status).toBe('completed')
  })

  it('is applied together with assignee changes, or not at all', async () => {
    const c = await team()
    const task = await sharedTask(c, 'all')
    const refused = await c.client.patch<ApiErrorBody>(`/api/tasks/${task.id}`, {
      body: {
        expectedVersion: task.version,
        assignmentMode: 'any',
        assigneeIds: [c.creator.id, '3f2b8f0c-6f6e-4a53-8f1c-1f9d5d4b9a77'],
      },
    })
    expect(refused.status).toBe(404)
    expect(await fetchTask(c.client, task.id)).toMatchObject({ assignmentMode: 'all', version: task.version })
    expect((await activityOf(c.client, task.id)).some((entry) => entry.action === 'mode_changed')).toBe(false)

    const together = await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: task.version, assignmentMode: 'any', assigneeIds: [c.creator.id, c.member('Fatima').id] },
    })
    expect(together.body.task).toMatchObject({ assignmentMode: 'any', version: task.version + 1 })
    expect(together.body.task.assignees.map((row) => row.memberId).sort()).toEqual(
      [c.creator.id, c.member('Fatima').id].sort(),
    )
  })
})

describe('integrity', () => {
  it('keeps the legacy single-assignee column equal to the first assignee', async () => {
    const c = await team()
    let task = await sharedTask(c, 'all')
    expect(task.assignedToMemberId).toBe(c.creator.id)
    task = (
      await c.client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
        body: { expectedVersion: task.version, assigneeIds: [c.member('Ibrahim').id, c.member('Mariama').id] },
      })
    ).body.task
    const stored = await database.db.query.tasks.findFirst({ where: (t, { eq: is }) => is(t.id, task.id) })
    expect(stored?.assignedToMemberId).toBe(task.assignees[0]?.memberId)
  })

  it('records admin-free member actions only with member actors', async () => {
    const c = await team()
    const task = await sharedTask(c, 'all')
    await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress')
    const history = await activityOf(c.client, task.id)
    expect(history.every((entry) => entry.actor.type === 'member')).toBe(true)
    const adminRows = await database.db
      .select()
      .from(taskAssignees)
      .where(and(eq(taskAssignees.taskId, task.id), isNotNull(taskAssignees.updatedByAdminId)))
    expect(adminRows).toHaveLength(0)
  })
})
