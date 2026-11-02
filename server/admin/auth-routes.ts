import { z } from 'zod'
import { adminEmailSchema } from '../../shared/schemas.js'
import { eq } from 'drizzle-orm'
import { adminAccounts, adminUsers } from '../db/schema.js'
import { ApiError } from '../errors.js'
import { json, noContent, readJson, type Handler, type RequestContext } from '../http.js'
import type { Route } from '../router-types.js'
import { getAdminSecret } from '../env.js'
import {
  ADMIN_MFA_POLICY,
  ADMIN_SIGN_IN_ACCOUNT_POLICY,
  ADMIN_SIGN_IN_POLICY,
  assertWithinLimit,
  recordAttempt,
} from '../security/rate-limit.js'
import { writeAudit, type AuditActor } from './audit.js'
import { createAdminAuth } from './auth.js'
import { adminHandler, assertAdminRequest } from './guard.js'
import { readAdminSession, type AdminSession } from './session.js'
import { MIN_ADMIN_PASSWORD_LENGTH } from './accounts-service.js'

/**
 * The only sign-in endpoints that are reachable. Collabo does not hand the auth library's
 * router to the internet: each endpoint below is forwarded deliberately, with Collabo's own
 * origin check, throttling, error format and audit trail around it, and with a body Collabo
 * built itself (so a client cannot, for instance, ask for a "trusted device" that skips
 * two-factor, or switch off session revocation). Everything else the library offers
 * (sign-up, password reset by email, social login, two-factor disable, session listing,
 * user updates, ...) answers 404.
 */

const passwordSchema = z.string().min(1, 'Enter your password').max(128)
const signInSchema = z.object({ email: adminEmailSchema, password: passwordSchema })
const codeSchema = z.object({
  code: z
    .string()
    .trim()
    .min(4, 'Enter the code')
    .max(24, 'That code is too long')
    .regex(/^[A-Za-z0-9 -]+$/, 'Enter the code exactly as shown'),
})
const confirmPasswordSchema = z.object({ password: passwordSchema })
const changePasswordSchema = z.object({
  currentPassword: passwordSchema,
  newPassword: z
    .string()
    .min(MIN_ADMIN_PASSWORD_LENGTH, `Use at least ${MIN_ADMIN_PASSWORD_LENGTH} characters`)
    .max(128, 'Use 128 characters or fewer'),
})

/** Sends a request the library will understand, carrying this request's cookies and origin. */
async function callAuth(ctx: RequestContext, path: string, body: Record<string, unknown>) {
  const url = new URL(ctx.request.url)
  url.pathname = `/api/auth${path}`
  url.search = ''
  const headers = new Headers(ctx.request.headers)
  headers.set('content-type', 'application/json')
  headers.delete('content-length')
  const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
  return createAdminAuth(ctx.db, ctx.request).handler(request)
}

interface AuthFailure {
  status: number
  code: string
  message: string
}

async function readFailure(response: Response): Promise<AuthFailure> {
  let code = ''
  let message = ''
  try {
    const body = (await response.json()) as { code?: unknown; message?: unknown }
    code = typeof body.code === 'string' ? body.code : ''
    message = typeof body.message === 'string' ? body.message : ''
  } catch {
    // Not JSON: nothing more to learn.
  }
  return { status: response.status, code, message }
}

/** Translates a library failure into Collabo's error contract, without leaking library internals. */
function toApiError(failure: AuthFailure): ApiError {
  const { status, code } = failure
  if (status === 429 || /TOO_MANY|LOCKED/.test(code)) return new ApiError('RATE_LIMITED')
  if (/INVALID_EMAIL_OR_PASSWORD|INVALID_PASSWORD|USER_NOT_FOUND|CREDENTIAL/.test(code)) {
    return new ApiError('INVALID_CREDENTIALS')
  }
  if (/INVALID_CODE|INVALID_BACKUP_CODE|INVALID_TOTP|TOTP/.test(code)) {
    return new ApiError('INVALID_TWO_FACTOR_CODE')
  }
  if (/PASSWORD_(TOO_SHORT|TOO_LONG)/.test(code)) {
    return new ApiError('VALIDATION_ERROR', { message: failure.message || undefined })
  }
  if (status === 401 || status === 403) {
    return new ApiError('ADMIN_REQUIRED', {
      message: 'That sign-in step expired. Start again from the sign-in page.',
    })
  }
  if (status >= 400 && status < 500) return new ApiError('VALIDATION_ERROR')
  console.error('[admin-auth] unexpected failure', { status, code })
  return new ApiError('SERVER_ERROR')
}

/** The administrator's identity as the audit log records it. */
function actorOf(user: { id: string; name: string; email: string }): AuditActor {
  return { adminId: user.id, name: user.name, email: user.email }
}

async function readUser(response: Response): Promise<AuditActor | null> {
  try {
    const body = (await response.json()) as { user?: { id?: string; name?: string; email?: string } }
    const user = body.user
    if (user?.id && user.name && user.email) return actorOf({ id: user.id, name: user.name, email: user.email })
  } catch {
    // ignore
  }
  return null
}

async function countFailedPassword(ctx: RequestContext, email: string): Promise<void> {
  await recordAttempt(ctx.db, ADMIN_SIGN_IN_POLICY, ctx.request)
  await recordAttempt(ctx.db, ADMIN_SIGN_IN_ACCOUNT_POLICY, ctx.request, email)
}

async function assertPasswordAttemptsLeft(ctx: RequestContext, email: string): Promise<void> {
  await assertWithinLimit(ctx.db, ADMIN_SIGN_IN_POLICY, ctx.request)
  await assertWithinLimit(ctx.db, ADMIN_SIGN_IN_ACCOUNT_POLICY, ctx.request, email)
}

/** Reject early (503) on deployments that have not set ADMIN_AUTH_SECRET. */
function prepare(ctx: RequestContext): void {
  assertAdminRequest(ctx.request)
  getAdminSecret()
}

/* -------------------------------------------------------------------------- */

/** POST /api/auth/sign-in/email: step one. Wrong passwords are throttled per client and per account. */
const signIn: Handler = async (ctx) => {
  prepare(ctx)
  const { email, password } = await readJson(ctx.request, signInSchema)
  await assertPasswordAttemptsLeft(ctx, email)

  const fail = async (): Promise<never> => {
    await countFailedPassword(ctx, email)
    throw new ApiError('INVALID_CREDENTIALS')
  }

  // A deactivated administrator is refused exactly like a wrong password.
  const known = await ctx.db
    .select({ status: adminAccounts.status })
    .from(adminUsers)
    .leftJoin(adminAccounts, eq(adminAccounts.userId, adminUsers.id))
    .where(eq(adminUsers.email, email))
  if (known[0] && known[0].status !== 'active') return fail()

  const response = await callAuth(ctx, '/sign-in/email', { email, password })
  if (!response.ok) {
    const failure = await readFailure(response)
    if (failure.status === 429) throw new ApiError('RATE_LIMITED')
    return fail()
  }

  const cookies = response.headers.getSetCookie()
  const body = (await response.clone().json()) as { twoFactorRedirect?: boolean }
  if (body.twoFactorRedirect) return json({ twoFactorRequired: true }, { cookies })

  // No authenticator enrolled yet: the library issued a session straight away. The admin API
  // stays closed to it until enrollment is finished (see requireAdmin).
  const user = await readUser(response)
  if (user) {
    await writeAudit(ctx.db, user, {
      action: 'admin.sign_in',
      targetType: 'admin',
      targetId: user.adminId,
      summary: { twoFactor: false },
    })
  }
  return json({ twoFactorRequired: false }, { cookies })
}

/** Step two (or enrollment confirmation): a 6-digit authenticator code, or a one-time backup code. */
function verifySecondFactor(kind: 'totp' | 'backup'): Handler {
  return async (ctx) => {
    prepare(ctx)
    const { code } = await readJson(ctx.request, codeSchema)
    await assertWithinLimit(ctx.db, ADMIN_MFA_POLICY, ctx.request)

    // A fully signed-in administrator without two-factor yet is enrolling; anyone else is signing in.
    const existing = await readAdminSession(ctx)
    const enrolling = existing !== null && !existing.twoFactorEnabled
    if (enrolling && existing.mustChangePassword) throw new ApiError('PASSWORD_CHANGE_REQUIRED')

    const response = await callAuth(
      ctx,
      kind === 'totp' ? '/two-factor/verify-totp' : '/two-factor/verify-backup-code',
      { code: code.replace(/\s/g, '') },
    )
    if (!response.ok) {
      await recordAttempt(ctx.db, ADMIN_MFA_POLICY, ctx.request)
      throw toApiError(await readFailure(response))
    }

    const cookies = response.headers.getSetCookie()
    const user = enrolling ? actorOf({ id: existing.adminId, name: existing.name, email: existing.email }) : await readUser(response)
    if (user) {
      await writeAudit(ctx.db, user, {
        action: enrolling ? 'admin.mfa_enrolled' : 'admin.sign_in',
        targetType: 'admin',
        targetId: user.adminId,
        summary: enrolling ? null : { twoFactor: kind === 'totp' ? 'authenticator' : 'backup_code' },
      })
    }
    return json({ enrolled: enrolling }, { cookies })
  }
}

/** POST /api/auth/sign-out: ends this session. Safe to call without one. */
const signOut: Handler = async (ctx) => {
  prepare(ctx)
  const admin = await readAdminSession(ctx)
  const response = await callAuth(ctx, '/sign-out', {})
  if (admin) {
    await writeAudit(ctx.db, actorOf({ id: admin.adminId, name: admin.name, email: admin.email }), {
      action: 'admin.sign_out',
      targetType: 'admin',
      targetId: admin.adminId,
    })
  }
  return noContent({ cookies: response.headers.getSetCookie() })
}

/** Begins authenticator enrollment: returns the setup link (for a QR code) and one-time backup codes. */
const enableTwoFactor = adminHandler(
  async (ctx, admin) => {
    if (admin.mustChangePassword) throw new ApiError('PASSWORD_CHANGE_REQUIRED')
    if (admin.twoFactorEnabled) {
      throw new ApiError('ADMIN_FORBIDDEN', {
        message: 'Two-factor authentication is already on for this account.',
      })
    }
    const { password } = await readJson(ctx.request, confirmPasswordSchema)
    await assertPasswordAttemptsLeft(ctx, admin.email)

    const response = await callAuth(ctx, '/two-factor/enable', { password })
    if (!response.ok) {
      const error = toApiError(await readFailure(response))
      if (error.code === 'INVALID_CREDENTIALS') await countFailedPassword(ctx, admin.email)
      throw error
    }
    const body = (await response.json()) as { totpURI?: string; backupCodes?: string[] }
    return json({ totpURI: body.totpURI, backupCodes: body.backupCodes })
  },
  { allowIncompleteSetup: true, transactional: false },
)

/** Replaces the one-time backup codes (old ones stop working). Needs the password again. */
const regenerateBackupCodes = adminHandler(
  async (ctx, admin) => {
    const { password } = await readJson(ctx.request, confirmPasswordSchema)
    await assertPasswordAttemptsLeft(ctx, admin.email)

    const response = await callAuth(ctx, '/two-factor/generate-backup-codes', { password })
    if (!response.ok) {
      const error = toApiError(await readFailure(response))
      if (error.code === 'INVALID_CREDENTIALS') await countFailedPassword(ctx, admin.email)
      throw error
    }
    const body = (await response.json()) as { backupCodes?: string[] }
    await writeAudit(ctx.db, actorOf({ id: admin.adminId, name: admin.name, email: admin.email }), {
      action: 'admin.backup_codes_regenerated',
      targetType: 'admin',
      targetId: admin.adminId,
    })
    return json({ backupCodes: body.backupCodes })
  },
  { transactional: false },
)

/** Changes the signed-in administrator's password, ends every other session, and clears the "must change" flag. */
const changePassword = adminHandler(
  async (ctx, admin) => {
    const { currentPassword, newPassword } = await readJson(ctx.request, changePasswordSchema)
    if (currentPassword === newPassword) {
      throw new ApiError('VALIDATION_ERROR', { message: 'Choose a password you have not used just now.' })
    }
    await assertPasswordAttemptsLeft(ctx, admin.email)

    const response = await callAuth(ctx, '/change-password', {
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    })
    if (!response.ok) {
      const error = toApiError(await readFailure(response))
      if (error.code === 'INVALID_CREDENTIALS') await countFailedPassword(ctx, admin.email)
      throw error
    }

    await ctx.db
      .update(adminAccounts)
      .set({ mustChangePassword: false })
      .where(eq(adminAccounts.userId, admin.adminId))
    await writeAudit(ctx.db, actorOf({ id: admin.adminId, name: admin.name, email: admin.email }), {
      action: 'admin.password_changed',
      targetType: 'admin',
      targetId: admin.adminId,
    })
    return json({ ok: true }, { cookies: response.headers.getSetCookie() })
  },
  { allowIncompleteSetup: true, transactional: false },
)

export const authRoutes: Route[] = [
  { method: 'POST', path: '/api/auth/sign-in/email', handler: signIn },
  { method: 'POST', path: '/api/auth/two-factor/verify-totp', handler: verifySecondFactor('totp') },
  { method: 'POST', path: '/api/auth/two-factor/verify-backup-code', handler: verifySecondFactor('backup') },
  { method: 'POST', path: '/api/auth/sign-out', handler: signOut },
  { method: 'POST', path: '/api/auth/two-factor/enable', handler: enableTwoFactor },
  { method: 'POST', path: '/api/auth/two-factor/generate-backup-codes', handler: regenerateBackupCodes },
  { method: 'POST', path: '/api/auth/change-password', handler: changePassword },
]

export type { AdminSession }
