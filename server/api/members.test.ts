import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { MemberDto } from '../../shared/types.js'
import { createCollabo, createTask, TestClient, type Collabo } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { activityOf, assignee, describeActivity, fetchTask, setStatus } from '../test/helpers.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

async function listMembers(client: TestClient): Promise<MemberDto[]> {
  const result = await client.get<{ members: MemberDto[] }>('/api/members')
  return result.body.members
}

const team = (): Promise<Collabo> => createCollabo({ memberNames: ['Mariama', 'Ibrahim'] })

describe('adding members', () => {
  it('adds a teammate later and tidies the name', async () => {
    const { client } = await createCollabo({ memberNames: [] })
    const added = await client.post<{ member: MemberDto }>('/api/members', { body: { name: '  Abu   Kamara ' } })
    expect(added.status).toBe(201)
    expect(added.body.member).toMatchObject({ name: 'Abu Kamara', isActive: true })
    expect((await listMembers(client)).map((m) => m.name)).toEqual(['Alhaji', 'Abu Kamara'])
  })

  it('refuses a second active member with the same name, ignoring case', async () => {
    const { client } = await team()
    const duplicate = await client.post<ApiErrorBody>('/api/members', { body: { name: 'MARIAMA' } })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('MEMBER_EXISTS')
  })

  it('rejects blank and oversized names', async () => {
    const { client } = await team()
    for (const body of [{ name: '' }, { name: '   ' }, { name: 'x'.repeat(41) }, {}, { names: [] }]) {
      expect((await client.post('/api/members', { body })).status).toBe(400)
    }
  })

  it('does not need the acting member (a newcomer adds themselves before choosing who they are)', async () => {
    const { client } = await team()
    expect((await client.post('/api/members', { body: { name: 'Newcomer' }, actor: null })).status).toBe(201)
  })
})

describe('larger teams', () => {
  const names = Array.from({ length: 40 }, (_, index) => `Person ${String(index + 1).padStart(2, '0')}`)

  it('has no cap on members: a Collabo can be created with and grow well past ten', async () => {
    const c = await createCollabo({ memberNames: names.slice(0, 25) })
    expect((await listMembers(c.client)).filter((m) => m.isActive)).toHaveLength(26)

    const bulk = await c.client.post<{ members: MemberDto[]; skipped: string[] }>('/api/members', {
      body: { names: names.slice(25) },
    })
    expect(bulk.status).toBe(201)
    expect(bulk.body.members).toHaveLength(15)
    expect((await listMembers(c.client)).filter((m) => m.isActive)).toHaveLength(41)
  })

  it('adds a pasted list in order, skipping and reporting names that already exist', async () => {
    const c = await team()
    const result = await c.client.post<{ members: MemberDto[]; skipped: string[] }>('/api/members', {
      body: { names: ['Zed', 'mariama', 'Yolanda', 'ZED', 'Xavier'] },
    })
    expect(result.status).toBe(201)
    expect(result.body.members.map((m) => m.name)).toEqual(['Zed', 'Yolanda', 'Xavier'])
    expect(result.body.skipped).toEqual(['mariama'])
    expect((await listMembers(c.client)).map((m) => m.name)).toEqual([
      'Alhaji', 'Mariama', 'Ibrahim', 'Zed', 'Yolanda', 'Xavier',
    ])
  })

  it('assigns a whole big team to one task, in the order chosen', async () => {
    const c = await createCollabo({ memberNames: names })
    const everyone = (await listMembers(c.client)).map((m) => m.id)
    const task = await createTask(c.client, { assigneeIds: everyone })
    expect(task.assignees).toHaveLength(41)
    expect(task.assignees.map((row) => row.memberId)).toEqual(everyone)
  })
})

describe('renaming', () => {
  it('renames a member while history keeps the name people had at the time', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.member('Mariama').id] })
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'in_progress')).body.task

    const renamed = await c.client.patch<{ member: MemberDto }>(`/api/members/${c.member('Mariama').id}`, {
      body: { name: 'Mariama Kamara' },
    })
    expect(renamed.status).toBe(200)
    expect((await listMembers(c.client)).find((m) => m.id === c.member('Mariama').id)?.name).toBe('Mariama Kamara')

    const history = await activityOf(c.client, task.id)
    expect(history.at(-2)).toMatchObject({ actor: { name: 'Mariama' }, subject: { name: 'Mariama' } })
  })

  it('refuses a name another member already uses, and unknown members', async () => {
    const c = await team()
    const clash = await c.client.patch<ApiErrorBody>(`/api/members/${c.member('Mariama').id}`, {
      body: { name: 'ibrahim' },
    })
    expect(clash.status).toBe(409)
    const unknown = await c.client.patch(`/api/members/3f2b8f0c-6f6e-4a53-8f1c-1f9d5d4b9a77`, { body: { name: 'Ghost' } })
    expect(unknown.status).toBe(404)
  })
})

describe('deactivating members', () => {
  it('is soft: history keeps their name, they leave the pickers, and they can come back', async () => {
    const c = await team()
    const mariama = c.member('Mariama')
    expect((await c.client.delete(`/api/members/${mariama.id}`)).status).toBe(204)

    expect((await listMembers(c.client)).find((m) => m.id === mariama.id)).toMatchObject({
      name: 'Mariama',
      isActive: false,
    })
    const back = await c.client.post<{ member: MemberDto }>(`/api/members/${mariama.id}/reactivate`)
    expect(back.body.member).toMatchObject({ id: mariama.id, isActive: true })
  })

  it('brings the same person back when their name is added again', async () => {
    const c = await team()
    const mariama = c.member('Mariama')
    await c.client.delete(`/api/members/${mariama.id}`)
    const readded = await c.client.post<{ member: MemberDto }>('/api/members', { body: { name: 'mariama' } })
    expect(readded.body.member).toMatchObject({ id: mariama.id, isActive: true })
    expect(await listMembers(c.client)).toHaveLength(3)
  })

  it('stops a removed member from acting or being newly assigned', async () => {
    const c = await team()
    const mariama = c.member('Mariama')
    await c.client.delete(`/api/members/${mariama.id}`)

    const acting = await c.client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Ghost', assigneeIds: [c.creator.id] },
      actor: mariama.id,
    })
    expect(acting.body.error.code).toBe('MEMBER_REQUIRED')
    const assigning = await c.client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'For a ghost', assigneeIds: [mariama.id] },
    })
    expect(assigning.body.error.code).toBe('MEMBER_NOT_FOUND')
  })

  it('refuses while they have unfinished tasks, and lists them', async () => {
    const c = await team()
    const mine = await createTask(c.client, { title: 'Only mine', assigneeIds: [c.member('Mariama').id] })
    await createTask(c.client, {
      title: 'Shared',
      assigneeIds: [c.member('Mariama').id, c.member('Ibrahim').id],
    })

    const refused = await c.client.delete<ApiErrorBody>(`/api/members/${c.member('Mariama').id}`)
    expect(refused.status).toBe(409)
    expect(refused.body.error.code).toBe('MEMBER_HAS_OPEN_TASKS')
    expect(refused.body.error.details).toMatchObject({ total: 2 })
    const listed = (refused.body.error.details as { tasks: { id: string; title: string; onlyAssignee: boolean }[] }).tasks
    expect(listed.find((t) => t.id === mine.id)?.onlyAssignee).toBe(true)
    expect(listed.find((t) => t.title === 'Shared')?.onlyAssignee).toBe(false)

    expect((await listMembers(c.client)).find((m) => m.id === c.member('Mariama').id)?.isActive).toBe(true)
  })

  it('can hand their work to someone else: everything moves in one step, with history', async () => {
    const c = await team()
    let mine = await createTask(c.client, { title: 'Only mine', assigneeIds: [c.member('Mariama').id] })
    mine = (await setStatus(c.as('Mariama'), mine, c.member('Mariama').id, 'in_progress')).body.task
    const shared = await createTask(c.client, {
      title: 'Shared',
      assigneeIds: [c.member('Mariama').id, c.member('Ibrahim').id],
    })

    const done = await c.client.post(`/api/members/${c.member('Mariama').id}/deactivate`, {
      body: { reassignToMemberId: c.member('Ibrahim').id },
    })
    expect(done.status).toBe(204)

    const afterMine = await fetchTask(c.client, mine.id)
    expect(afterMine.assignees.map((row) => row.memberId)).toEqual([c.member('Ibrahim').id])
    expect(afterMine.assignees[0]?.status).toBe('todo') // Ibrahim starts fresh; Mariama's progress is history
    expect(afterMine.status).toBe('todo')
    const afterShared = await fetchTask(c.client, shared.id)
    expect(afterShared.assignees.map((row) => row.memberId)).toEqual([c.member('Ibrahim').id])

    expect(describeActivity(await activityOf(c.client, mine.id))).toEqual(
      expect.arrayContaining(['assignee_added:Ibrahim', 'assignee_removed:Mariama']),
    )
    expect((await listMembers(c.client)).find((m) => m.id === c.member('Mariama').id)?.isActive).toBe(false)
  })

  it('can simply remove them where others remain, but never from a task they alone are on', async () => {
    const c = await team()
    const shared = await createTask(c.client, {
      title: 'Shared',
      assigneeIds: [c.member('Mariama').id, c.member('Ibrahim').id],
    })
    const solo = await createTask(c.client, { title: 'Solo', assigneeIds: [c.member('Mariama').id] })

    const refused = await c.client.post<ApiErrorBody>(`/api/members/${c.member('Mariama').id}/deactivate`, {
      body: { reassignToMemberId: null },
    })
    expect(refused.status).toBe(409)
    // Atomic: the shared task was not touched either.
    expect((await fetchTask(c.client, shared.id)).assignees).toHaveLength(2)

    await c.client.delete(`/api/tasks/${solo.id}`)
    const ok = await c.client.post(`/api/members/${c.member('Mariama').id}/deactivate`, {
      body: { reassignToMemberId: null },
    })
    expect(ok.status).toBe(204)
    expect((await fetchTask(c.client, shared.id)).assignees.map((r) => r.memberId)).toEqual([c.member('Ibrahim').id])
  })

  it('recalculates progress when removing someone: ALL completes if the rest are done', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.member('Mariama').id, c.member('Ibrahim').id] })
    task = (await setStatus(c.as('Ibrahim'), task, c.member('Ibrahim').id, 'completed')).body.task
    expect(task.status).toBe('in_progress')

    await c.client.post(`/api/members/${c.member('Mariama').id}/deactivate`, { body: { reassignToMemberId: null } })
    expect((await fetchTask(c.client, task.id)).status).toBe('completed')
  })

  it('leaves finished tasks alone, so a person with only completed work can leave without resolution', async () => {
    const c = await team()
    let task = await createTask(c.client, { assigneeIds: [c.member('Mariama').id] })
    task = (await setStatus(c.as('Mariama'), task, c.member('Mariama').id, 'completed')).body.task

    expect((await c.client.delete(`/api/members/${c.member('Mariama').id}`)).status).toBe(204)
    const after = await fetchTask(c.client, task.id)
    expect(after.status).toBe('completed')
    expect(assignee(after, c.member('Mariama').id).status).toBe('completed')
  })

  it('never removes the last active member', async () => {
    const c = await createCollabo({ memberNames: ['Mariama'] })
    expect((await c.client.delete(`/api/members/${c.member('Mariama').id}`)).status).toBe(204)
    const last = await c.client.delete<ApiErrorBody>(`/api/members/${c.creator.id}`)
    expect(last.status).toBe(409)
    expect(last.body.error.code).toBe('LAST_MEMBER')
  })

  it('treats removing someone twice as done, and unknown or malformed ids as errors', async () => {
    const c = await team()
    const id = c.member('Mariama').id
    expect((await c.client.delete(`/api/members/${id}`)).status).toBe(204)
    expect((await c.client.delete(`/api/members/${id}`)).status).toBe(204)
    expect((await c.client.delete('/api/members/3f2b8f0c-6f6e-4a53-8f1c-1f9d5d4b9a77')).status).toBe(404)
    expect((await c.client.delete('/api/members/nope')).status).toBe(400)
  })

  it('rejects reassigning to themselves, or to someone who is not an active member', async () => {
    const c = await team()
    await createTask(c.client, { assigneeIds: [c.member('Mariama').id, c.creator.id] })
    const self = await c.client.post<ApiErrorBody>(`/api/members/${c.member('Mariama').id}/deactivate`, {
      body: { reassignToMemberId: c.member('Mariama').id },
    })
    expect(self.status).toBe(404)
    const other = await createCollabo()
    const foreign = await c.client.post<ApiErrorBody>(`/api/members/${c.member('Mariama').id}/deactivate`, {
      body: { reassignToMemberId: other.creator.id },
    })
    expect(foreign.status).toBe(404)
    expect((await listMembers(c.client)).find((m) => m.id === c.member('Mariama').id)?.isActive).toBe(true)
  })
})
