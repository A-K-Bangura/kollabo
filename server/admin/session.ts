import { eq } from 'drizzle-orm'
import { adminAccounts } from '../db/schema.js'
import { ApiError } from '../errors.js'
import type { RequestContext } from '../http.js'
import { createAdminAuth } from './auth.js'

/** A verified platform administrator. Always read from the database, never from the request body. */
export interface AdminSession {
  adminId: string
  name: string
  email: string
  twoFactorEnabled: boolean
  mustChangePassword: boolean
}

/**
 * The administrator behind this request's sign-in cookie, or null. The cookie is checked
 * by the auth library (signature, expiry, revocation: every request reads the session
 * row, there is no cookie-only cache), and then Collabo adds its own rule: a deactivated
 * administrator is never accepted, even holding a session that was valid a moment ago.
 */
export async function readAdminSession(ctx: RequestContext): Promise<AdminSession | null> {
  const auth = createAdminAuth(ctx.db, ctx.request)
  const result = await auth.api.getSession({ headers: ctx.request.headers })
  if (!result) return null

  const account = await ctx.db.query.adminAccounts.findFirst({
    where: eq(adminAccounts.userId, result.user.id),
    columns: { status: true, mustChangePassword: true },
  })
  if (!account || account.status !== 'active') return null

  return {
    adminId: result.user.id,
    name: result.user.name,
    email: result.user.email,
    twoFactorEnabled: result.user.twoFactorEnabled === true,
    mustChangePassword: account.mustChangePassword,
  }
}

interface RequireAdminOptions {
  /**
   * Accept an administrator who has not finished account setup (new password, two-factor
   * enrollment). Only the endpoints that perform that setup, and `me`, may pass this.
   */
  allowIncompleteSetup?: boolean
}

/**
 * The gate in front of every admin endpoint. It is not optional and not inferred from
 * anything the client sends: no valid administrator session means 401, and a signed-in
 * administrator still cannot use the admin API until they have chosen their own password
 * and enrolled two-factor authentication.
 */
export async function requireAdmin(
  ctx: RequestContext,
  options: RequireAdminOptions = {},
): Promise<AdminSession> {
  const admin = await readAdminSession(ctx)
  if (!admin) throw new ApiError('ADMIN_REQUIRED')
  if (options.allowIncompleteSetup) return admin

  if (admin.mustChangePassword) throw new ApiError('PASSWORD_CHANGE_REQUIRED')
  if (!admin.twoFactorEnabled) throw new ApiError('MFA_REQUIRED')
  return admin
}
