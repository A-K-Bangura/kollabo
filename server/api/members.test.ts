import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { ActivityDto, MemberDto, TaskDto } from '../../shared/types.js'
import { createCollabo, createTask, TestClient } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

async function listMembers(client: TestClient): Promise<MemberDto[]> {
  const result = await client.get<{ members: MemberDto[] }>('/api/members')
  return result.body.members
}

describe('adding members', () => {
  it('adds a teammate later and tidies the name', async () => {
    const { client } = await createCollabo({ memberNames: [] })
    const added = await client.post<{ member: MemberDto }>('/api/members', {
      body: { name: '  Abu   Kamara ' },
    })
    expect(added.status).toBe(201)
    expect(added.body.member).toMatchObject({ name: 'Abu Kamara', isActive: true })
    expect((await listMembers(client)).map((member) => member.name)).toEqual(['Alhaji', 'Abu Kamara'])
  })

  it('refuses a second active member with the same name, ignoring case', async () => {
    const { client } = await createCollabo()
    const duplicate = await client.post<ApiErrorBody>('/api/members', { body: { name: 'MARIAMA' } })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('MEMBER_EXISTS')
  })

  it('rejects blank and oversized names', async () => {
    const { client } = await createCollabo()
    for (const name of ['', '   ', 'x'.repeat(41)]) {
      expect((await client.post('/api/members', { body: { name } })).status).toBe(400)
    }
  })

  it('does not need the acting member (a newcomer adds themselves before choosing who they are)', async () => {
    const { client } = await createCollabo()
    const result = await client.post('/api/members', { body: { name: 'Newcomer' }, actor: null })
    expect(result.status).toBe(201)
  })
})

describe('removing members', () => {
  it('soft-removes: the member leaves the pickers but history keeps their name', async () => {
    const { client, members } = await createCollabo()
    const mariama = members.find((member) => member.name === 'Mariama')!
    const task = await createTask(client, { assignedToMemberId: mariama.id })

    const removed = await client.delete(`/api/members/${mariama.id}`)
    expect(removed.status).toBe(204)

    const after = await listMembers(client)
    expect(after.find((member) => member.id === mariama.id)).toMatchObject({
      name: 'Mariama',
      isActive: false,
    })

    // Tasks and activity are untouched.
    const fetched = await client.get<{ task: TaskDto }>(`/api/tasks/${task.id}`)
    expect(fetched.body.task.assignedToMemberId).toBe(mariama.id)
  })

  it('keeps attribution for work a removed member did', async () => {
    const { client, members } = await createCollabo()
    const ibrahim = members.find((member) => member.name === 'Ibrahim')!
    const task = await createTask(client)
    await client.patch(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, status: 'completed' },
      actor: ibrahim.id,
    })

    await client.delete(`/api/members/${ibrahim.id}`)

    const fetched = await client.get<{ task: TaskDto }>(`/api/tasks/${task.id}`)
    expect(fetched.body.task.completedByMemberId).toBe(ibrahim.id)
    const activity = await client.get<{ activity: ActivityDto[] }>(`/api/tasks/${task.id}/activity`)
    expect(activity.body.activity.some((entry) => entry.memberId === ibrahim.id)).toBe(true)
  })

  it('stops a removed member from acting or being newly assigned work', async () => {
    const { client, members } = await createCollabo()
    const mariama = members.find((member) => member.name === 'Mariama')!
    const task = await createTask(client, { assignedToMemberId: mariama.id })
    await client.delete(`/api/members/${mariama.id}`)

    const acting = await client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'Ghost' },
      actor: mariama.id,
    })
    expect(acting.body.error.code).toBe('MEMBER_REQUIRED')

    const assigning = await client.post<ApiErrorBody>('/api/tasks', {
      body: { title: 'For a ghost', assignedToMemberId: mariama.id },
    })
    expect(assigning.status).toBe(404)
    expect(assigning.body.error.code).toBe('MEMBER_NOT_FOUND')

    // Editing the task she already owns is still fine: her assignment is just kept.
    const edited = await client.patch<{ task: TaskDto }>(`/api/tasks/${task.id}`, {
      body: { expectedVersion: 1, title: 'Still hers', assignedToMemberId: mariama.id },
    })
    expect(edited.status).toBe(200)
    expect(edited.body.task.assignedToMemberId).toBe(mariama.id)
  })

  it('brings the same person back instead of creating a lookalike', async () => {
    const { client, members } = await createCollabo()
    const mariama = members.find((member) => member.name === 'Mariama')!
    await client.delete(`/api/members/${mariama.id}`)

    const readded = await client.post<{ member: MemberDto }>('/api/members', {
      body: { name: 'mariama' },
    })
    expect(readded.status).toBe(201)
    expect(readded.body.member).toMatchObject({ id: mariama.id, isActive: true })
    expect(await listMembers(client)).toHaveLength(3)
  })

  it('never removes the last active member', async () => {
    const { client, members } = await createCollabo({ memberNames: ['Mariama'] })
    const [first, second] = members
    expect((await client.delete(`/api/members/${second!.id}`)).status).toBe(204)

    const last = await client.delete<ApiErrorBody>(`/api/members/${first!.id}`)
    expect(last.status).toBe(409)
    expect(last.body.error.code).toBe('LAST_MEMBER')
  })

  it('treats removing someone twice as done, and unknown or malformed ids as errors', async () => {
    const { client, members } = await createCollabo()
    const mariama = members.find((member) => member.name === 'Mariama')!
    expect((await client.delete(`/api/members/${mariama.id}`)).status).toBe(204)
    expect((await client.delete(`/api/members/${mariama.id}`)).status).toBe(204)

    expect((await client.delete('/api/members/3f2b8f0c-6f6e-4a53-8f1c-1f9d5d4b9a77')).status).toBe(404)
    expect((await client.delete('/api/members/nope')).status).toBe(400)
  })
})
