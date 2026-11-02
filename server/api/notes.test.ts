import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { TaskDto } from '../../shared/types.js'
import { taskNoteRevisions } from '../db/schema.js'
import { createCollabo, createTask, type Collabo } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { activityOf, fetchTask, revisionsOf, setStatus } from '../test/helpers.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

function team(): Promise<Collabo> {
  return createCollabo({ memberNames: ['Mariama', 'Ibrahim'] })
}

const editNote = (c: Collabo['client'], task: TaskDto, content: string, expectedNoteVersion = task.progressNoteVersion) =>
  c.put<{ task: TaskDto }>(`/api/tasks/${task.id}/note`, { body: { content, expectedNoteVersion } })

describe('the shared progress note', () => {
  it('starts empty, and one edit writes the note, a revision and a history entry', async () => {
    const c = await team()
    const task = await createTask(c.client, { assigneeIds: [c.creator.id, c.member('Mariama').id] })
    expect(task).toMatchObject({ progressNote: null, progressNoteVersion: 0, noteUpdatedBy: null })

    const mariama = c.as('Mariama')
    const result = await editNote(mariama, task, 'Hero section done, pricing next.')
    expect(result.status).toBe(200)
    expect(result.body.task).toMatchObject({
      progressNote: 'Hero section done, pricing next.',
      progressNoteVersion: 1,
      noteUpdatedBy: { type: 'member', name: 'Mariama' },
      version: task.version + 1,
    })
    expect(result.body.task.noteUpdatedAt).not.toBeNull()

    const [revision] = await revisionsOf(c.client, task.id)
    expect(revision).toMatchObject({
      revisionNumber: 1,
      content: 'Hero section done, pricing next.',
      isClear: false,
      editor: { type: 'member', name: 'Mariama' },
    })
    const entry = (await activityOf(c.client, task.id)).at(-1)
    expect(entry).toMatchObject({ action: 'note_edited', details: { revision: 1 }, actor: { name: 'Mariama' } })
  })

  it('keeps every earlier version, newest first, each attributed', async () => {
    const c = await team()
    const task = await createTask(c.client, { assigneeIds: [c.creator.id, c.member('Mariama').id] })
    let current = (await editNote(c.client, task, 'v1')).body.task
    current = (await editNote(c.as('Mariama'), current, 'v2')).body.task
    current = (await editNote(c.client, current, 'v3')).body.task

    const revisions = await revisionsOf(c.client, task.id)
    expect(revisions.map((r) => [r.revisionNumber, r.content, r.editor.name])).toEqual([
      [3, 'v3', 'Alhaji'],
      [2, 'v2', 'Mariama'],
      [1, 'v1', 'Alhaji'],
    ])
    expect(current.progressNote).toBe('v3')
  })

  it('creates no revision when nothing actually changes', async () => {
    const c = await team()
    const task = await createTask(c.client)
    const first = (await editNote(c.client, task, 'Same text')).body.task
    const again = await editNote(c.client, first, '  Same text  ')
    expect(again.status).toBe(200)
    expect(again.body.task.progressNoteVersion).toBe(1)
    expect(again.body.task.version).toBe(first.version)
    expect(await revisionsOf(c.client, task.id)).toHaveLength(1)
  })

  it('only lets assigned members write it', async () => {
    const c = await team()
    const task = await createTask(c.client, { assigneeIds: [c.creator.id] })
    const outsider = await editNote(c.as('Ibrahim'), task, 'Sneaking in')
    expect(outsider.status).toBe(403)
    expect((outsider.body as unknown as ApiErrorBody).error.code).toBe('NOT_ASSIGNED')
    expect((await fetchTask(c.client, task.id)).progressNote).toBeNull()
  })

  it('stores text as plain text and returns it unchanged', async () => {
    const c = await team()
    const task = await createTask(c.client)
    const risky = '<script>alert(1)</script> <img src=x onerror=alert(2)> & "quotes"'
    const result = await editNote(c.client, task, risky)
    expect(result.body.task.progressNote).toBe(risky)
  })

  it('rejects blank and oversized notes on the note endpoint', async () => {
    const c = await team()
    const task = await createTask(c.client)
    for (const content of ['', '   ', 'x'.repeat(4001)]) {
      const result = await editNote(c.client, task, content)
      expect(result.status).toBe(400)
    }
    expect((await fetchTask(c.client, task.id)).progressNoteVersion).toBe(0)
  })
})

describe('clearing is a deliberate, separate action', () => {
  it('removes the note but keeps a tombstone revision, and later edits continue the numbering', async () => {
    const c = await team()
    const task = await createTask(c.client)
    let current = (await editNote(c.client, task, 'Draft')).body.task

    const cleared = await c.client.delete<{ task: TaskDto }>(
      `/api/tasks/${task.id}/note?expectedNoteVersion=${current.progressNoteVersion}`,
    )
    expect(cleared.status).toBe(200)
    current = cleared.body.task
    expect(current).toMatchObject({ progressNote: null, progressNoteVersion: 2 })

    const revisions = await revisionsOf(c.client, task.id)
    expect(revisions[0]).toMatchObject({ revisionNumber: 2, content: null, isClear: true })
    expect(revisions[1]).toMatchObject({ revisionNumber: 1, content: 'Draft' }) // never lost
    expect((await activityOf(c.client, task.id)).at(-1)?.action).toBe('note_cleared')

    current = (await editNote(c.client, current, 'Fresh start')).body.task
    expect(current.progressNoteVersion).toBe(3)
  })

  it('does nothing when there is no note to clear', async () => {
    const c = await team()
    const task = await createTask(c.client)
    const result = await c.client.delete<{ task: TaskDto }>(`/api/tasks/${task.id}/note?expectedNoteVersion=0`)
    expect(result.status).toBe(200)
    expect(await revisionsOf(c.client, task.id)).toHaveLength(0)
  })

  it('is never triggered by leaving a note field empty during a progress change', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.member('Mariama').id] })
    task = (await editNote(c.as('Mariama'), task, 'Keep me')).body.task

    for (const blank of [undefined, '', '   ']) {
      const result = await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress', {
        ...(blank === undefined ? {} : { note: blank }),
        expectedNoteVersion: task.progressNoteVersion,
      })
      expect(result.status).toBe(200)
      expect(result.body.task.progressNote).toBe('Keep me')
      expect(result.body.task.progressNoteVersion).toBe(1)
      task = result.body.task
      if (task.status === 'in_progress') {
        task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'todo')).body.task
      }
    }
    expect(await revisionsOf(c.client, task.id)).toHaveLength(1)
  })
})

describe('concurrent edits never lose a note', () => {
  it('returns 409 for a stale edit and leaves the winning note and history intact', async () => {
    const c = await team()
    const task = await createTask(c.client, { assigneeIds: [c.creator.id, c.member('Mariama').id] })

    // Both open the note when it is empty.
    const win = await editNote(c.as('Mariama'), task, "Mariama's progress report")
    expect(win.status).toBe(200)

    const lose = await editNote(c.client, task, "Alhaji's competing text")
    expect(lose.status).toBe(409)
    expect((lose.body as unknown as ApiErrorBody).error.code).toBe('NOTE_CONFLICT')

    expect((await fetchTask(c.client, task.id)).progressNote).toBe("Mariama's progress report")
    expect(await revisionsOf(c.client, task.id)).toHaveLength(1)
  })

  it('lets exactly one of two simultaneous edits win', async () => {
    const c = await team()
    const task = await createTask(c.client, { assigneeIds: [c.creator.id, c.member('Mariama').id] })
    const results = await Promise.all([
      editNote(c.client, task, 'From Alhaji'),
      editNote(c.as('Mariama'), task, 'From Mariama'),
    ])
    expect(results.map((r) => r.status).sort()).toEqual([200, 409])
    expect(await revisionsOf(c.client, task.id)).toHaveLength(1)
  })

  it('refuses a stale clear too', async () => {
    const c = await team()
    const task = await createTask(c.client)
    await editNote(c.client, task, 'Draft')
    const stale = await c.client.delete(`/api/tasks/${task.id}/note?expectedNoteVersion=0`)
    expect(stale.status).toBe(409)
    expect((await fetchTask(c.client, task.id)).progressNote).toBe('Draft')
  })

  it('has unique, gap-free revision numbers per task', async () => {
    const c = await team()
    const task = await createTask(c.client)
    let current = task
    for (const text of ['a', 'b', 'c', 'd']) current = (await editNote(c.client, current, text)).body.task
    const rows = await database.db.select().from(taskNoteRevisions).where(eq(taskNoteRevisions.taskId, task.id))
    expect(rows.map((row) => row.revisionNumber).sort()).toEqual([1, 2, 3, 4])
  })
})

describe('notes alongside progress changes', () => {
  it('replaces the note with the status change in one step, when a note is given', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.member('Mariama').id] })
    const result = await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress', {
      note: 'Started on the hero section',
      expectedNoteVersion: 0,
    })
    task = result.body.task
    expect(task).toMatchObject({
      status: 'in_progress',
      progressNote: 'Started on the hero section',
      progressNoteVersion: 1,
      version: 2, // one change, one version
    })
    const history = (await activityOf(c.client, task.id)).map((entry) => entry.action)
    expect(history.slice(-3)).toEqual(['assignee_status_changed', 'status_changed', 'note_edited'])
  })

  it('changes nothing at all when the note is stale: status and note are atomic', async () => {
    const c = await team()
    const task = await createTask(c.client, { assigneeIds: [c.creator.id, c.member('Mariama').id] })
    await editNote(c.client, task, 'Someone wrote this first')

    const stale = await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress', {
      note: 'My update',
      expectedNoteVersion: 0,
    })
    expect(stale.status).toBe(409)
    expect((stale.body as unknown as ApiErrorBody).error.code).toBe('NOTE_CONFLICT')

    const after = await fetchTask(c.client, task.id)
    expect(after.progressNote).toBe('Someone wrote this first')
    expect(after.assignees.find((row) => row.memberId === c.member('Mariama').id)?.status).toBe('todo')
  })

  it('does not erase the note when status changes later', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.member('Mariama').id] })
    task = (await editNote(c.as('Mariama'), task, 'Notes survive')).body.task
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress')).body.task
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task
    expect(task).toMatchObject({ status: 'completed', progressNote: 'Notes survive', progressNoteVersion: 1 })
  })

  it('can be sent with an explicit reopen', async () => {
    const c = await team()
    let task = await createTask(c.client, {
      assigneeIds: [c.creator.id, c.member('Mariama').id],
      assignmentMode: 'any',
    })
    task = (await setStatus(c.client, task, c.creator.id, 'completed')).body.task
    const reopened = await c.as('Mariama').post<{ task: TaskDto }>(`/api/tasks/${task.id}/reopen`, {
      body: { expectedVersion: task.version, note: 'Found a bug, reopening', expectedNoteVersion: 0 },
    })
    expect(reopened.body.task).toMatchObject({ status: 'in_progress', progressNote: 'Found a bug, reopening' })
  })
})

describe('immutability', () => {
  it('offers no way to change or delete a revision through the API', async () => {
    const c = await team()
    const task = await createTask(c.client)
    await editNote(c.client, task, 'Original')
    const [revision] = await revisionsOf(c.client, task.id)
    for (const method of ['put', 'patch', 'delete'] as const) {
      const result = await c.client[method](`/api/tasks/${task.id}/note/revisions/${revision?.id}`)
      expect([404, 405]).toContain(result.status)
    }
    const post = await c.client.post(`/api/tasks/${task.id}/note/revisions`, { body: { content: 'x' } })
    expect([404, 405]).toContain(post.status)
  })

  it('is enforced by the database: a revision row cannot be updated', async () => {
    const c = await team()
    const task = await createTask(c.client)
    await editNote(c.client, task, 'Original')
    await expect(
      database.db.update(taskNoteRevisions).set({ content: 'Tampered' }).where(eq(taskNoteRevisions.taskId, task.id)),
    ).rejects.toThrow(/append-only|cannot be updated|update/i)
    expect((await revisionsOf(c.client, task.id))[0]?.content).toBe('Original')
  })
})
