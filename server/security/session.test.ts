import { createHmac } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildClearedSessionCookie,
  buildSessionCookie,
  createSessionToken,
  readSessionCookie,
  verifySessionToken,
} from './session.js'

const PROJECT_ID = '0b9d7f5e-2f1c-4d56-9c6f-6a3c1f0e8a11'
const DAY_MS = 24 * 60 * 60 * 1000

function flipLastCharacter(value: string): string {
  return value.slice(0, -1) + (value.endsWith('A') ? 'B' : 'A')
}

describe('session tokens', () => {
  it('round-trips the project and session version', () => {
    const token = createSessionToken({ projectId: PROJECT_ID, version: 3 })
    expect(verifySessionToken(token)).toEqual({ projectId: PROJECT_ID, version: 3 })
  })

  it('rejects a token whose payload was edited to name another project', () => {
    const [, signature] = createSessionToken({ projectId: PROJECT_ID, version: 1 }).split('.')
    const forgedPayload = Buffer.from(
      JSON.stringify({
        p: '11111111-1111-4111-8111-111111111111',
        v: 1,
        exp: Math.floor(Date.now() / 1000) + 1000,
      }),
    ).toString('base64url')
    expect(verifySessionToken(`${forgedPayload}.${signature}`)).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const token = createSessionToken({ projectId: PROJECT_ID, version: 1 })
    expect(verifySessionToken(flipLastCharacter(token))).toBeNull()
  })

  it('rejects a token signed with a different secret', () => {
    const payload = Buffer.from(
      JSON.stringify({ p: PROJECT_ID, v: 1, exp: Math.floor(Date.now() / 1000) + 1000 }),
    ).toString('base64url')
    const signature = createHmac('sha256', 'some-other-secret-that-is-long-enough!!').update(payload).digest('base64url')
    expect(verifySessionToken(`${payload}.${signature}`)).toBeNull()
  })

  it('rejects expired tokens', () => {
    const issuedAt = Date.now()
    const token = createSessionToken({ projectId: PROJECT_ID, version: 1 }, issuedAt)
    expect(verifySessionToken(token, issuedAt + 29 * DAY_MS)).not.toBeNull()
    expect(verifySessionToken(token, issuedAt + 31 * DAY_MS)).toBeNull()
  })

  it('rejects garbage without throwing', () => {
    for (const junk of ['', 'abc', '.', 'a.b.c', 'not-base64.!!!', '{}.{}']) {
      expect(verifySessionToken(junk)).toBeNull()
    }
  })
})

describe('session cookie', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('is HttpOnly, SameSite=Strict and scoped to the whole site', () => {
    const cookie = buildSessionCookie('token', new Request('https://collabo.test/api/session'))
    expect(cookie).toContain('collabo_session=token')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')
    expect(cookie).toContain('Path=/')
    expect(cookie).toMatch(/Max-Age=\d+/)
  })

  it('is Secure over https and always in production, but works on plain http locally', () => {
    expect(buildSessionCookie('t', new Request('https://collabo.test/'))).toContain('Secure')
    expect(buildSessionCookie('t', new Request('http://localhost:5173/'))).not.toContain('Secure')

    vi.stubEnv('NODE_ENV', 'production')
    expect(buildSessionCookie('t', new Request('http://internal/'))).toContain('Secure')
  })

  it('can be cleared', () => {
    const cleared = buildClearedSessionCookie(new Request('https://collabo.test/'))
    expect(cleared).toContain('collabo_session=;')
    expect(cleared).toContain('Max-Age=0')
  })

  it('is found among other cookies', () => {
    const request = new Request('https://collabo.test/', {
      headers: { cookie: 'theme=dark; collabo_session=abc.def; other=1' },
    })
    expect(readSessionCookie(request)).toBe('abc.def')
    expect(readSessionCookie(new Request('https://collabo.test/'))).toBeNull()
  })
})
