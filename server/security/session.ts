import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { getEnv } from '../env.js'

export const SESSION_COOKIE = 'collabo_session'
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30

const claimsSchema = z.object({
  /** The one project this session is for. */
  p: z.uuid(),
  /** projects.session_version when issued; a regenerated code bumps it. */
  v: z.number().int().min(1),
  /** Expiry, seconds since epoch. */
  exp: z.number().int(),
})

export interface SessionClaims {
  projectId: string
  version: number
}

function sign(payload: string): Buffer {
  return createHmac('sha256', getEnv().SESSION_SECRET).update(payload).digest()
}

/** `base64url(claims).base64url(hmac)`: stateless, tamper-evident, scoped to one project. */
export function createSessionToken(claims: SessionClaims, nowMs = Date.now()): string {
  const payload = Buffer.from(
    JSON.stringify({
      p: claims.projectId,
      v: claims.version,
      exp: Math.floor(nowMs / 1000) + SESSION_TTL_SECONDS,
    }),
  ).toString('base64url')
  return `${payload}.${sign(payload).toString('base64url')}`
}

/** Returns the claims for a genuine, unexpired token, otherwise null. */
export function verifySessionToken(token: string, nowMs = Date.now()): SessionClaims | null {
  const [payload, signature, ...extra] = token.split('.')
  if (!payload || !signature || extra.length > 0) return null

  const given = Buffer.from(signature, 'base64url')
  const expected = sign(payload)
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null

  let json: unknown
  try {
    json = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  const claims = claimsSchema.safeParse(json)
  if (!claims.success || claims.data.exp * 1000 <= nowMs) return null

  return { projectId: claims.data.p, version: claims.data.v }
}

export function readSessionCookie(request: Request): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue
    if (part.slice(0, separator).trim() === SESSION_COOKIE) return part.slice(separator + 1).trim()
  }
  return null
}

function isSecureContext(request: Request): boolean {
  return process.env.NODE_ENV === 'production' || new URL(request.url).protocol === 'https:'
}

function cookie(value: string, maxAge: number, request: Request): string {
  const attributes = [`${SESSION_COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAge}`]
  if (isSecureContext(request)) attributes.push('Secure')
  return attributes.join('; ')
}

/** HttpOnly (no script access), SameSite=Strict, and Secure in production. */
export function buildSessionCookie(token: string, request: Request): string {
  return cookie(token, SESSION_TTL_SECONDS, request)
}

export function buildClearedSessionCookie(request: Request): string {
  return cookie('', 0, request)
}
