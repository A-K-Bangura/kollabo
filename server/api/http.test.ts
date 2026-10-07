import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import { overrideDatabaseOpener } from '../db/client.js'
import { createCollabo, TestClient } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())
afterEach(() => vi.restoreAllMocks())

describe('request safety', () => {
  it('refuses writes that a browser sends from another origin', async () => {
    const { client } = await createCollabo()
    const result = await client.post<ApiErrorBody>('/api/members', {
      body: { name: 'Eve' },
      headers: { origin: 'https://evil.example', host: 'collabo.test' },
    })
    expect(result.status).toBe(403)
    expect(result.body.error.code).toBe('FORBIDDEN_ORIGIN')
  })

  it('accepts writes from its own origin', async () => {
    const { client } = await createCollabo()
    const result = await client.post('/api/members', {
      body: { name: 'Same Origin' },
      headers: { origin: 'https://collabo.test', host: 'collabo.test' },
    })
    expect(result.status).toBe(201)
  })

  it('only accepts JSON bodies', async () => {
    const result = await new TestClient().post<ApiErrorBody>('/api/session', {
      rawBody: 'code=ABCD',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
    })
    expect(result.status).toBe(415)
    expect(result.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE')
  })

  it('rejects oversized bodies and malformed JSON', async () => {
    const client = new TestClient()
    const huge = await client.post<ApiErrorBody>('/api/session', {
      rawBody: JSON.stringify({ code: 'x'.repeat(40_000) }),
    })
    expect(huge.status).toBe(413)

    const broken = await client.post<ApiErrorBody>('/api/session', { rawBody: '{"code":' })
    expect(broken.status).toBe(400)
    expect(broken.body.error.code).toBe('VALIDATION_ERROR')
  })

  it('marks every response as uncacheable', async () => {
    const { client } = await createCollabo()
    for (const result of [
      await client.get('/api/tasks'),
      await client.get('/api/project'),
      await new TestClient().get('/api/members'),
    ]) {
      expect(result.headers.get('cache-control')).toBe('no-store')
    }
  })
})

describe('error contract', () => {
  it('uses one { error: { code, message } } shape, with field details for validation', async () => {
    const { client } = await createCollabo()
    const result = await client.post<ApiErrorBody>('/api/tasks', { body: { title: '' } })
    expect(result.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Title is required',
        details: { title: ['Title is required'] },
      },
    })
  })

  it('hides infrastructure failures: generic message to the client, no secrets in logs', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    overrideDatabaseOpener(async () => {
      throw new Error('connect ECONNREFUSED postgres://admin:hunter2@db.internal:5432/prod')
    })

    try {
      const result = await new TestClient().post<ApiErrorBody>('/api/session', {
        body: { code: 'K7QM-2XPA-9WTH' },
      })
      expect(result.status).toBe(500)
      expect(result.body).toEqual({
        error: { code: 'SERVER_ERROR', message: 'Something went wrong on our side. Please try again.' },
      })
      expect(JSON.stringify(result.body)).not.toMatch(/hunter2|postgres|ECONNREFUSED/)
      expect(JSON.stringify(logged.mock.calls)).not.toMatch(/hunter2|postgres:\/\/|K7QM/)
    } finally {
      overrideDatabaseOpener(async () => ({ db: database.db, close: async () => undefined }))
    }
  })

  it('closes the database connection after every request, including failures', async () => {
    let closed = 0
    overrideDatabaseOpener(async () => ({
      db: database.db,
      close: async () => {
        closed += 1
      },
    }))
    try {
      const client = new TestClient()
      await client.get('/api/project') // 401
      await client.post('/api/session', { body: { code: 'nope' } }) // 400
      expect(closed).toBe(2)
    } finally {
      overrideDatabaseOpener(async () => ({ db: database.db, close: async () => undefined }))
    }
  })
})
