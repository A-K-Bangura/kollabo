import { eq, ne } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ApiErrorBody } from '../../shared/errors.js'
import { adminAccounts, adminAuditLogs, adminSessions, adminUsers } from '../db/schema.js'
import { resetEnvCache } from '../env.js'
import { createCollabo, TestClient } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { AdminClient, ADMIN_PASSWORD, createTestAdmin, ORIGIN, signedInAdmin, totpFor } from '../test/admin.js'
import { setAdminActive } from './accounts-service.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

const codeOf = (result: { body: unknown }) => (result.body as ApiErrorBody).error.code

describe('there is no public way to become an administrator', () => {
  it('has no sign-up, and none of the library endpoints Collabo does not use', async () => {
    const client = new TestClient()
    const before = await database.db.select().from(adminUsers)

    for (const [method, path] of [
      ['POST', '/api/auth/sign-up/email'],
      ['POST', '/api/auth/request-password-reset'],
      ['POST', '/api/auth/reset-password'],
      ['POST', '/api/auth/two-factor/disable'],
      ['POST', '/api/auth/two-factor/send-otp'],
      ['GET', '/api/auth/list-sessions'],
      ['POST', '/api/auth/update-user'],
      ['POST', '/api/auth/sign-in/social'],
      ['GET', '/api/auth/get-session'],
      ['GET', '/api/auth/ok'],
    ] as const) {
      const result = await client.send(method, path, {
        body: method === 'POST' ? { email: 'x@example.com', password: 'a-long-enough-password', name: 'X' } : undefined,
        headers: { origin: ORIGIN },
      })
      expect([404, 405], `${method} ${path}`).toContain(result.status)
    }
    expect(await database.db.select().from(adminUsers)).toHaveLength(before.length)
  })

  it('has no way to create one through a Collabo project session either', async () => {
    const { client } = await createCollabo()
    const result = await client.post<ApiErrorBody>('/api/admin/admins', {
      body: { name: 'Mallory', email: 'mallory@example.com' },
      headers: { origin: ORIGIN },
    })
    expect(result.status).toBe(401)
    expect(codeOf(result)).toBe('ADMIN_REQUIRED')
  })
})

describe('a deployment without ADMIN_AUTH_SECRET', () => {
  it('has no admin area, while everything else keeps working', async () => {
    const saved = process.env.ADMIN_AUTH_SECRET
    delete process.env.ADMIN_AUTH_SECRET
    resetEnvCache()
    try {
      const client = new TestClient()
      const me = await client.get<ApiErrorBody>('/api/admin/me')
      expect(me.status).toBe(503)
      expect(codeOf(me)).toBe('ADMIN_NOT_CONFIGURED')

      const signIn = await client.post<ApiErrorBody>('/api/auth/sign-in/email', {
        body: { email: 'a@example.com', password: 'whatever-it-is' },
        headers: { origin: ORIGIN },
      })
      expect(signIn.status).toBe(503)

      expect((await createCollabo()).client.sessionCookie).toBeDefined()
    } finally {
      process.env.ADMIN_AUTH_SECRET = saved
      resetEnvCache()
    }
  })
})

describe('signing in', () => {
  it('answers a wrong password and an unknown email identically', async () => {
    const admin = await createTestAdmin(database.db)
    const wrong = await admin.signIn('not the password!!')
    const unknown = await new TestClient().post<ApiErrorBody>('/api/auth/sign-in/email', {
      body: { email: 'nobody@example.com', password: 'not the password!!' },
      headers: { origin: ORIGIN },
    })
    expect(wrong.status).toBe(401)
    expect(unknown.status).toBe(401)
    expect(wrong.body).toEqual(unknown.body)
    expect(codeOf(wrong)).toBe('INVALID_CREDENTIALS')
    expect(wrong.setCookies).toEqual([])
  })

  it('issues HttpOnly, SameSite=Strict, Secure cookies that carry no readable identity', async () => {
    const admin = await createTestAdmin(database.db)
    const result = await admin.signIn()
    expect(result.status).toBe(200)
    expect(result.setCookies.length).toBeGreaterThan(0)
    for (const cookie of result.setCookies) {
      expect(cookie).toMatch(/HttpOnly/i)
      expect(cookie).toMatch(/SameSite=Strict/i)
      expect(cookie).toMatch(/Secure/i)
      expect(cookie).toMatch(/^__Secure-collabo_admin\./)
    }
    // The body never hands the page a session token.
    expect(JSON.stringify(result.body)).not.toMatch(/token/i)
  })

  it('keeps the admin API closed to a password-only session until two-factor is set up', async () => {
    const admin = await createTestAdmin(database.db)
    expect((await admin.signIn()).status).toBe(200)

    const blocked = await admin.get<ApiErrorBody>('/api/admin/overview')
    expect(blocked.status).toBe(403)
    expect(codeOf(blocked)).toBe('MFA_REQUIRED')

    const me = await admin.get<{ admin: { twoFactorEnabled: boolean; mustChangePassword: boolean } }>('/api/admin/me')
    expect(me.status).toBe(200)
    expect(me.body.admin).toMatchObject({ twoFactorEnabled: false, mustChangePassword: false })

    // Enrollment is not complete until a real code from the authenticator is presented.
    const started = await admin.startEnrollment()
    expect(started.status).toBe(200)
    expect(started.body.totpURI).toMatch(/^otpauth:\/\/totp\//)
    expect(started.body.backupCodes.length).toBeGreaterThanOrEqual(8)
    expect((await admin.get('/api/admin/overview')).status).toBe(403)

    const bad = await admin.verifyCode('000000')
    expect(bad.status).toBe(401)
    expect(codeOf(bad)).toBe('INVALID_TWO_FACTOR_CODE')
    expect((await admin.get('/api/admin/overview')).status).toBe(403)

    const done = await admin.verifyCode(totpFor(admin.totpURI!))
    expect(done.status).toBe(200)
    expect(done.body.enrolled).toBe(true)
    expect((await admin.get('/api/admin/overview')).status).toBe(200)
  })

  it('then requires the authenticator code at every sign-in', async () => {
    const admin = await signedInAdmin(database.db)
    const later = admin.newBrowser()

    const first = await later.signIn()
    expect(first.body).toEqual({ twoFactorRequired: true })
    // Password alone gets nothing.
    const early = await later.get<ApiErrorBody>('/api/admin/overview')
    expect(early.status).toBe(401)
    expect(codeOf(early)).toBe('ADMIN_REQUIRED')

    const wrong = await later.verifyCode('123456')
    expect(wrong.status).toBe(401)
    expect((await later.get('/api/admin/overview')).status).toBe(401)

    const right = await later.verifyCode(totpFor(later.totpURI!))
    expect(right.status).toBe(200)
    expect(right.body.enrolled).toBe(false)
    expect((await later.get('/api/admin/overview')).status).toBe(200)
  })

  it('accepts each one-time backup code once', async () => {
    const admin = await signedInAdmin(database.db)
    const [code] = admin.backupCodes
    expect(code).toBeDefined()

    const one = admin.newBrowser()
    await one.signIn()
    const used = await one.post('/api/auth/two-factor/verify-backup-code', { body: { code } })
    expect(used.status).toBe(200)
    expect((await one.get('/api/admin/overview')).status).toBe(200)

    const two = admin.newBrowser()
    await two.signIn()
    const reused = await two.post<ApiErrorBody>('/api/auth/two-factor/verify-backup-code', { body: { code } })
    expect(reused.status).toBe(401)
    expect(codeOf(reused)).toBe('INVALID_TWO_FACTOR_CODE')
  })

  it('signs out for real: the old cookie stops working', async () => {
    const admin = await signedInAdmin(database.db)
    const stolen = admin.clone()
    expect((await stolen.get('/api/admin/overview')).status).toBe(200)

    const out = await admin.post('/api/auth/sign-out', { body: {} })
    expect(out.status).toBe(204)
    expect((await stolen.get<ApiErrorBody>('/api/admin/overview')).status).toBe(401)
  })
})

describe('throttling', () => {
  it('slows down password guessing from one client, whichever accounts it tries', async () => {
    const admin = await createTestAdmin(database.db)
    const guesser = new TestClient()
    const guess = (email: string) =>
      guesser.post<ApiErrorBody>('/api/auth/sign-in/email', {
        body: { email, password: 'wrong password here' },
        headers: { origin: ORIGIN },
      })
    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await guess(`nobody${attempt}@example.com`)).status).toBe(401)
    }
    const blocked = await guess('nobody-else@example.com')
    expect(blocked.status).toBe(429)
    expect(codeOf(blocked)).toBe('RATE_LIMITED')
    expect(blocked.headers.get('retry-after')).toBeTruthy()

    // Even the right password waits, from that client.
    const right = await guesser.post('/api/auth/sign-in/email', {
      body: { email: admin.email, password: ADMIN_PASSWORD },
      headers: { origin: ORIGIN },
    })
    expect(right.status).toBe(429)
  })

  it('protects one account from guessing spread across many clients', async () => {
    const admin = await createTestAdmin(database.db)
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const other = new TestClient()
      const result = await other.post('/api/auth/sign-in/email', {
        body: { email: admin.email, password: 'wrong password here' },
        headers: { origin: ORIGIN },
      })
      expect(result.status).toBe(401)
    }
    const fresh = new TestClient()
    const blocked = await fresh.post<ApiErrorBody>('/api/auth/sign-in/email', {
      body: { email: admin.email, password: ADMIN_PASSWORD },
      headers: { origin: ORIGIN },
    })
    expect(blocked.status).toBe(429)
  })

  it('does not count successful sign-ins', async () => {
    const admin = await createTestAdmin(database.db)
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect((await admin.newBrowser().signIn()).status).toBe(200)
    }
  })

  it('locks guessing of second-factor codes', async () => {
    const admin = await signedInAdmin(database.db)
    const later = admin.newBrowser()
    await later.signIn()
    const statuses: number[] = []
    for (let attempt = 0; attempt < 9; attempt += 1) statuses.push((await later.verifyCode('000000')).status)
    expect(statuses.slice(0, 4)).toEqual([401, 401, 401, 401])
    expect(statuses.at(-1)).toBe(429)
    // The genuine code no longer works while the lock holds.
    expect((await later.verifyCode(totpFor(later.totpURI!))).status).not.toBe(200)
  })
})

describe('request forgery', () => {
  it('refuses changes that do not come from this site', async () => {
    const admin = await signedInAdmin(database.db)
    const body = { reason: 'because I say so' }
    const project = (await createCollabo()).projectId

    const noOrigin = await admin.post<ApiErrorBody>(`/api/admin/projects/${project}/suspend`, {
      body,
      headers: { origin: '' },
    })
    expect(noOrigin.status).toBe(403)

    const foreign = await admin.post<ApiErrorBody>(`/api/admin/projects/${project}/suspend`, {
      body,
      headers: { origin: 'https://evil.example', host: 'collabo.test' },
    })
    expect(foreign.status).toBe(403)

    const crossSite = await admin.post<ApiErrorBody>(`/api/admin/projects/${project}/suspend`, {
      body,
      headers: { 'sec-fetch-site': 'cross-site' },
    })
    expect(crossSite.status).toBe(403)

    // Nothing happened to the project.
    const detail = await admin.get<{ project: { status: string } }>(`/api/admin/projects/${project}`)
    expect(detail.body.project.status).toBe('active')
  })

  it('also refuses a sign-in or sign-out that does not come from this site', async () => {
    const admin = await createTestAdmin(database.db)
    const result = await admin.signIn().then(async () =>
      admin.post<ApiErrorBody>('/api/auth/sign-out', { body: {}, headers: { origin: 'https://evil.example', host: 'collabo.test' } }),
    )
    expect(result.status).toBe(403)
  })
})

describe('the two kinds of access never mix', () => {
  it('does not let a project session into the admin area, nor an admin session into a project', async () => {
    const { client } = await createCollabo()
    const admin = await signedInAdmin(database.db)

    for (const path of ['/api/admin/me', '/api/admin/overview', '/api/admin/projects', '/api/admin/audit', '/api/admin/admins']) {
      const result = await client.get<ApiErrorBody>(path)
      expect(result.status, path).toBe(401)
    }

    const asMember = await admin.get<ApiErrorBody>('/api/tasks')
    expect(asMember.status).toBe(401)
    expect(codeOf(asMember)).toBe('UNAUTHENTICATED')
  })

  it('does not accept a forged or tampered admin cookie', async () => {
    const admin = await signedInAdmin(database.db)
    const forged = new TestClient()
    forged.setCookie('__Secure-collabo_admin.session_token', 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA%3D')
    expect((await forged.get('/api/admin/overview', { headers: { origin: ORIGIN } })).status).toBe(401)

    const [row] = await database.db.select().from(adminSessions)
    expect(row).toBeDefined()
    const rawToken = new TestClient()
    rawToken.setCookie('__Secure-collabo_admin.session_token', row!.token)
    expect((await rawToken.get('/api/admin/overview')).status).toBe(401)
    expect((await admin.get('/api/admin/overview')).status).toBe(200)
  })
})

describe('administrator accounts', () => {
  it('forces a person given a temporary password to choose their own before anything else', async () => {
    const creator = await signedInAdmin(database.db)
    const created = await creator.post<{ admin: { id: string; email: string; mustChangePassword: boolean }; temporaryPassword: string }>(
      '/api/admin/admins',
      { body: { name: 'New Person', email: 'New.Person@Example.com' } },
    )
    expect(created.status).toBe(201)
    expect(created.body.admin).toMatchObject({ email: 'new.person@example.com', mustChangePassword: true })
    expect(created.body.temporaryPassword.length).toBeGreaterThanOrEqual(20)

    const person = new AdminClient('new.person@example.com', created.body.temporaryPassword)
    expect((await person.signIn()).status).toBe(200)

    const blocked = await person.get<ApiErrorBody>('/api/admin/overview')
    expect(blocked.status).toBe(403)
    expect(codeOf(blocked)).toBe('PASSWORD_CHANGE_REQUIRED')
    expect(codeOf(await person.startEnrollment())).toBe('PASSWORD_CHANGE_REQUIRED')
    expect((await person.get<{ admin: { mustChangePassword: boolean } }>('/api/admin/me')).body.admin.mustChangePassword).toBe(true)

    const weak = await person.post<ApiErrorBody>('/api/auth/change-password', {
      body: { currentPassword: created.body.temporaryPassword, newPassword: 'short' },
    })
    expect(weak.status).toBe(400)
    const wrongCurrent = await person.post<ApiErrorBody>('/api/auth/change-password', {
      body: { currentPassword: 'not the temporary password', newPassword: 'a brand new long password' },
    })
    expect(wrongCurrent.status).toBe(401)

    const changed = await person.post('/api/auth/change-password', {
      body: { currentPassword: created.body.temporaryPassword, newPassword: 'a brand new long password' },
    })
    expect(changed.status).toBe(200)
    // Still needs two-factor, then everything opens.
    expect(codeOf(await person.get<ApiErrorBody>('/api/admin/overview'))).toBe('MFA_REQUIRED')
    expect((await person.startEnrollment('a brand new long password')).status).toBe(200)
    expect((await person.verifyCode(totpFor(person.totpURI!))).status).toBe(200)
    expect((await person.get('/api/admin/overview')).status).toBe(200)

    // The temporary password is dead.
    expect((await new AdminClient('new.person@example.com', created.body.temporaryPassword).signIn()).status).toBe(401)
  })

  it('cannot enroll a second authenticator on an account that already has one', async () => {
    const admin = await signedInAdmin(database.db)
    const again = await admin.startEnrollment()
    expect(again.status).toBe(403)
    expect(codeOf(again)).toBe('ADMIN_FORBIDDEN')
  })

  it('ends every other session when the password changes', async () => {
    const admin = await signedInAdmin(database.db)
    const elsewhere = admin.newBrowser()
    await elsewhere.signIn()
    await elsewhere.verifyCode(totpFor(elsewhere.totpURI!))
    expect((await elsewhere.get('/api/admin/overview')).status).toBe(200)

    const changed = await admin.post('/api/auth/change-password', {
      body: { currentPassword: ADMIN_PASSWORD, newPassword: 'another long password!!' },
    })
    expect(changed.status).toBe(200)
    expect((await elsewhere.get('/api/admin/overview')).status).toBe(401)
    expect((await admin.get('/api/admin/overview')).status).toBe(200)
  })

  it('stops a deactivated administrator at once, even mid-session', async () => {
    const boss = await signedInAdmin(database.db)
    const target = await signedInAdmin(database.db)
    const targetId = (await target.get<{ admin: { id: string } }>('/api/admin/me')).body.admin.id
    expect((await target.get('/api/admin/overview')).status).toBe(200)

    const result = await boss.post(`/api/admin/admins/${targetId}/deactivate`, { body: { reason: 'left the company' } })
    expect(result.status).toBe(200)
    expect((await target.get<ApiErrorBody>('/api/admin/overview')).status).toBe(401)

    // Not even a fresh sign-in, with the right password and authenticator.
    const again = target.newBrowser()
    expect((await again.signIn()).status).toBe(401)

    const reactivated = await boss.post(`/api/admin/admins/${targetId}/reactivate`, { body: {} })
    expect(reactivated.status).toBe(200)
    expect((await again.signIn()).status).toBe(200)
  })

  it('cannot deactivate itself', async () => {
    const admin = await signedInAdmin(database.db)
    const myId = (await admin.get<{ admin: { id: string } }>('/api/admin/me')).body.admin.id
    const result = await admin.post<ApiErrorBody>(`/api/admin/admins/${myId}/deactivate`, { body: {} })
    expect(result.status).toBe(403)
    expect(codeOf(result)).toBe('ADMIN_FORBIDDEN')
    expect((await admin.get('/api/admin/overview')).status).toBe(200)
  })

  it('never lets the last active administrator be deactivated', async () => {
    const survivor = await signedInAdmin(database.db)
    const survivorId = (await survivor.get<{ admin: { id: string } }>('/api/admin/me')).body.admin.id
    await database.db
      .update(adminAccounts)
      .set({ status: 'deactivated' })
      .where(ne(adminAccounts.userId, survivorId))

    await expect(setAdminActive(database.db, 'some-other-admin', survivorId, false)).rejects.toMatchObject({
      code: 'ADMIN_FORBIDDEN',
    })
    expect((await survivor.get('/api/admin/overview')).status).toBe(200)

    await database.db.update(adminAccounts).set({ status: 'active' })
  })

  it('records sign-ins, enrollment and password changes in the audit log, never a password or code', async () => {
    const admin = await signedInAdmin(database.db)
    await admin.post('/api/auth/change-password', {
      body: { currentPassword: ADMIN_PASSWORD, newPassword: 'yet another long password' },
    })
    const logs = await database.db.select().from(adminAuditLogs).where(eq(adminAuditLogs.adminEmail, admin.email))
    const actions = logs.map((log) => log.action)
    expect(actions).toEqual(expect.arrayContaining(['admin.mfa_enrolled', 'admin.password_changed']))

    const everything = JSON.stringify(await database.db.select().from(adminAuditLogs))
    expect(everything).not.toContain(ADMIN_PASSWORD)
    expect(everything).not.toContain('yet another long password')
    for (const code of admin.backupCodes) expect(everything).not.toContain(code)
    expect(everything).not.toContain(new URL(admin.totpURI!).searchParams.get('secret')!)
  })
})
