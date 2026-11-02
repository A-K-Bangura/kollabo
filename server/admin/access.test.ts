import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import { createCollabo, TestClient } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { createTestAdmin, ORIGIN, signedInAdmin } from '../test/admin.js'
import { adminRoutes } from './routes.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

/** Sign-in steps are reachable before you are signed in; everything else is behind the guard. */
const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/sign-in/email',
  '/api/auth/two-factor/verify-totp',
  '/api/auth/two-factor/verify-backup-code',
  '/api/auth/sign-out',
])

const guarded = adminRoutes.filter(
  (route) => route.path.startsWith('/api/admin/') || !PUBLIC_AUTH_PATHS.has(route.path),
)

const SAMPLE = '00000000-0000-4000-8000-000000000001'
const concretePath = (path: string) => path.replace(/:\w+/g, SAMPLE)
const codeOf = (body: unknown) => (body as ApiErrorBody).error.code

describe('every admin endpoint enforces admin privilege on the server', () => {
  it('has a meaningful number of guarded routes to check', () => {
    expect(guarded.length).toBeGreaterThan(30)
    // Everything under /api/admin that touches a project is reachable via the shared handlers too.
    expect(guarded.some((route) => route.path === '/api/admin/projects/:projectId/tasks')).toBe(true)
  })

  it('refuses every one of them without a sign-in', async () => {
    const stranger = new TestClient()
    for (const route of guarded) {
      const result = await stranger.send(route.method, concretePath(route.path), {
        body: route.method === 'GET' ? undefined : {},
        headers: { origin: ORIGIN },
      })
      expect(result.status, `${route.method} ${route.path}`).toBe(401)
      expect(codeOf(result.body), `${route.method} ${route.path}`).toBe('ADMIN_REQUIRED')
    }
  })

  it('refuses every one of them for a member of a real project, however they ask', async () => {
    const { client, projectId } = await createCollabo({ name: 'Curious members' })
    for (const route of guarded) {
      const path = concretePath(route.path).replace(SAMPLE, projectId)
      const result = await client.send(route.method, path, {
        body: route.method === 'GET' ? undefined : {},
        headers: { origin: ORIGIN },
      })
      expect(result.status, `${route.method} ${route.path}`).toBe(401)
    }
  })

  it('refuses all but the setup endpoints until two-factor is enrolled', async () => {
    const partial = await createTestAdmin(database.db)
    expect((await partial.signIn()).status).toBe(200)
    const allowed = new Set([
      '/api/admin/me',
      '/api/auth/two-factor/enable',
      '/api/auth/change-password',
    ])
    for (const route of guarded) {
      if (allowed.has(route.path)) continue
      const result = await partial.send(route.method, concretePath(route.path), {
        body: route.method === 'GET' ? undefined : {},
      })
      expect(result.status, `${route.method} ${route.path}`).toBe(403)
      expect(codeOf(result.body), `${route.method} ${route.path}`).toBe('MFA_REQUIRED')
    }
  })

  it('refuses all but the setup endpoints until a temporary password is replaced', async () => {
    const fresh = await createTestAdmin(database.db, { mustChangePassword: true })
    expect((await fresh.signIn()).status).toBe(200)
    const allowed = new Set(['/api/admin/me', '/api/auth/change-password'])
    for (const route of guarded) {
      if (allowed.has(route.path)) continue
      const result = await fresh.send(route.method, concretePath(route.path), {
        body: route.method === 'GET' ? undefined : {},
      })
      expect(result.status, `${route.method} ${route.path}`).toBe(403)
      expect(codeOf(result.body), `${route.method} ${route.path}`).toBe('PASSWORD_CHANGE_REQUIRED')
    }
  })

  it('opens them to a fully set-up administrator (and the guard is the only thing in the way)', async () => {
    const admin = await signedInAdmin(database.db)
    const team = await createCollabo()
    for (const route of guarded.filter((candidate) => candidate.method === 'GET')) {
      const path = concretePath(route.path).replace(SAMPLE, team.projectId)
      const result = await admin.send('GET', path)
      expect([200, 404], `${route.path}`).toContain(result.status)
    }
  })

  it('answers unknown admin paths with 404 rather than leaking anything', async () => {
    const admin = await signedInAdmin(database.db)
    expect((await admin.get('/api/admin/nope')).status).toBe(404)
    const wrong = await admin.send('DELETE', '/api/admin/overview')
    expect(wrong.status).toBe(405)
  })
})
