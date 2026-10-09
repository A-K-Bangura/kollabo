import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import type { CreateProjectResponse, MemberDto, ProjectDto } from '../../shared/types.js'
import { projects } from '../db/schema.js'
import { generateAccessCode } from '../security/codes.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { createCollabo, joinWithCode, TestClient } from '../test/client.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

const CODE_PATTERN = /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/

describe('creating a Collabo (scenario A)', () => {
  it('returns the code once, signs the creator in, and lists the members', async () => {
    const { client, code, creator, members } = await createCollabo({
      name: 'UniVybe Website',
      creatorName: 'Alhaji',
      memberNames: ['Mariama', 'Ibrahim'],
    })

    expect(code).toMatch(CODE_PATTERN)
    expect(client.sessionCookie).toBeTruthy()
    expect(creator.name).toBe('Alhaji')
    expect(members.map((member) => member.name)).toEqual(['Alhaji', 'Mariama', 'Ibrahim'])

    const project = await client.get<{ project: ProjectDto }>('/api/project')
    expect(project.body.project.name).toBe('UniVybe Website')
  })

  it('works for a solo creator with no extra members', async () => {
    const client = new TestClient()
    const result = await client.post<CreateProjectResponse>('/api/projects', {
      body: { name: 'Just me', creatorName: 'Alhaji' },
    })
    expect(result.status).toBe(201)
    expect(result.body.members).toHaveLength(1)
  })

  it('sets an HttpOnly, SameSite session cookie and keeps the code out of the body of later calls', async () => {
    const { client } = await createCollabo()
    const result = await client.get('/api/project')
    expect(JSON.stringify(result.body)).not.toMatch(CODE_PATTERN)

    const created = await new TestClient().post('/api/projects', {
      body: { name: 'Cookie check', creatorName: 'A' },
    })
    const cookie = created.setCookies[0] ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Secure') // the test requests use https
  })

  it('stores only a keyed hash of the code, never the code', async () => {
    const { projectId, code } = await createCollabo()
    const [row] = await database.db.select().from(projects).where(eq(projects.id, projectId))

    expect(row?.accessCodeHash).toMatch(/^[0-9a-f]{64}$/)
    const stored = JSON.stringify(row).toUpperCase()
    expect(stored).not.toContain(code)
    expect(stored).not.toContain(code.replaceAll('-', ''))
  })

  it('requires a project name and creator name, and removes duplicate teammates', async () => {
    const client = new TestClient()
    const missing = await client.post<ApiErrorBody>('/api/projects', { body: { name: '  ' } })
    expect(missing.status).toBe(400)
    expect(missing.body.error.code).toBe('VALIDATION_ERROR')
    expect(Object.keys(missing.body.error.details ?? {})).toEqual(
      expect.arrayContaining(['name', 'creatorName']),
    )

    const created = await client.post<CreateProjectResponse>('/api/projects', {
      body: {
        name: 'Dupes',
        creatorName: 'Alhaji',
        memberNames: ['alhaji', 'Mariama', ' mariama ', 'Ibrahim'],
      },
    })
    expect(created.body.members.map((member) => member.name)).toEqual(['Alhaji', 'Mariama', 'Ibrahim'])
  })
})

describe('entering with a code (scenario B)', () => {
  it('lets a teammate in, forgiving case and separators, and shows who is on the team', async () => {
    const { code } = await createCollabo({ memberNames: ['Mariama', 'Ibrahim'] })

    const sloppy = code.toLowerCase().replaceAll('-', ' ')
    const mariama = await joinWithCode(sloppy)
    const members = await mariama.get<{ members: MemberDto[] }>('/api/members')
    expect(members.body.members.map((member) => member.name)).toEqual(['Alhaji', 'Mariama', 'Ibrahim'])
  })

  it('rejects a wrong code without issuing a session or hinting at what was close', async () => {
    await createCollabo()
    const client = new TestClient()
    const result = await client.post<ApiErrorBody>('/api/session', {
      body: { code: generateAccessCode() },
    })

    expect(result.status).toBe(401)
    expect(result.body.error.code).toBe('INVALID_CODE')
    expect(result.setCookies).toEqual([])
    expect(client.sessionCookie).toBeUndefined()
  })

  it('rejects malformed codes as validation errors', async () => {
    const client = new TestClient()
    for (const code of ['', 'nope', 'AAAA-BBBB', "'; DROP TABLE projects; --", 12345]) {
      const result = await client.post<ApiErrorBody>('/api/session', { body: { code } })
      expect(result.status).toBe(400)
      expect(result.body.error.code).toBe('VALIDATION_ERROR')
    }
  })

  it('throttles repeated wrong guesses per client, even for the right code, but not other clients', async () => {
    const { code } = await createCollabo()
    const attacker = new TestClient()

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await attacker.post<ApiErrorBody>('/api/session', {
        body: { code: generateAccessCode() },
      })
      expect(result.status).toBe(401)
    }

    const blocked = await attacker.post<ApiErrorBody>('/api/session', { body: { code } })
    expect(blocked.status).toBe(429)
    expect(blocked.body.error.code).toBe('RATE_LIMITED')
    expect(Number(blocked.headers.get('retry-after'))).toBeGreaterThan(0)
    expect(attacker.sessionCookie).toBeUndefined()

    const someoneElse = new TestClient()
    const fine = await someoneElse.post('/api/session', { body: { code } })
    expect(fine.status).toBe(200)
  })

  it('does not count correct codes against the limit', async () => {
    const { code } = await createCollabo()
    const client = new TestClient()
    for (let attempt = 0; attempt < 15; attempt += 1) {
      expect((await client.post('/api/session', { body: { code } })).status).toBe(200)
    }
  })
})

describe('sessions', () => {
  it('requires a session for project data', async () => {
    const client = new TestClient()
    for (const path of ['/api/project', '/api/members', '/api/tasks']) {
      const result = await client.get<ApiErrorBody>(path)
      expect(result.status).toBe(401)
      expect(result.body.error.code).toBe('UNAUTHENTICATED')
    }
  })

  it('rejects a forged or tampered cookie and clears it', async () => {
    const { client } = await createCollabo()
    const real = client.sessionCookie ?? ''
    const attacker = new TestClient()

    for (const forged of ['garbage', `${real.slice(0, -2)}xx`, `x.${real.split('.')[1]}`]) {
      attacker.setSessionCookie(forged)
      const result = await attacker.get<ApiErrorBody>('/api/project')
      expect(result.status).toBe(401)
      expect(result.body.error.code).toBe('SESSION_INVALID')
      expect(result.setCookies.join(';')).toContain('Max-Age=0')
    }
  })

  it('leaving signs the browser out', async () => {
    const { client } = await createCollabo()
    expect((await client.delete('/api/session')).status).toBe(204)
    expect(client.sessionCookie).toBeUndefined()
    expect((await client.get('/api/project')).status).toBe(401)
  })
})

describe('regenerating the code (scenario G)', () => {
  it('kills the old code and every older session, keeps the caller signed in with the new code', async () => {
    const { client: alhaji, code: oldCode } = await createCollabo()
    const mariama = await joinWithCode(oldCode)
    expect((await mariama.get('/api/tasks')).status).toBe(200)

    const result = await alhaji.post<{ accessCode: string }>('/api/project/regenerate-code')
    expect(result.status).toBe(200)
    const newCode = result.body.accessCode
    expect(newCode).toMatch(CODE_PATTERN)
    expect(newCode).not.toBe(oldCode)

    // Another member's existing session is dead and told to start over.
    const stale = await mariama.get<ApiErrorBody>('/api/tasks')
    expect(stale.status).toBe(401)
    expect(stale.body.error.code).toBe('SESSION_INVALID')

    // The old code no longer works for anyone.
    const oldAttempt = await new TestClient().post<ApiErrorBody>('/api/session', {
      body: { code: oldCode },
    })
    expect(oldAttempt.status).toBe(401)
    expect(oldAttempt.body.error.code).toBe('INVALID_CODE')

    // The person who regenerated keeps working; the new code lets others back in.
    expect((await alhaji.get('/api/tasks')).status).toBe(200)
    const rejoined = await joinWithCode(newCode)
    expect((await rejoined.get('/api/tasks')).status).toBe(200)
  })

  it('invalidates a copy of the pre-regeneration cookie', async () => {
    const { client } = await createCollabo()
    const stolenCopy = client.clone()

    await client.post('/api/project/regenerate-code')

    expect((await stolenCopy.get('/api/project')).status).toBe(401)
    expect((await client.get('/api/project')).status).toBe(200)
  })

  it('requires a session', async () => {
    const result = await new TestClient().post<ApiErrorBody>('/api/project/regenerate-code')
    expect(result.status).toBe(401)
  })
})
