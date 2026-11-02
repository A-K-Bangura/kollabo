import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import { twoFactor } from 'better-auth/plugins'
import { eq } from 'drizzle-orm'
import type { Database } from '../db/client.js'
import {
  adminAccounts,
  adminAuthAccounts,
  adminSessions,
  adminTwoFactors,
  adminUsers,
  adminVerifications,
} from '../db/schema.js'
import { getAdminSecret } from '../env.js'

/** An admin session lasts a working day at most, and is refreshed only while it is being used. */
const SESSION_SECONDS = 60 * 60 * 8
export const ADMIN_COOKIE_PREFIX = 'collabo_admin'

/**
 * Platform-administrator sign-in, delegated to Better Auth (a maintained, widely used
 * library) so Collabo contains no hand-written password hashing, session or TOTP code.
 * It is deliberately configured as narrowly as possible:
 *
 *  - email + password only, with public sign-up switched off: administrators exist only
 *    because someone ran the bootstrap script or an existing admin created them;
 *  - two-factor (TOTP) required by Collabo before any admin API is usable;
 *  - HttpOnly, SameSite=Strict cookies (Secure over https), under their own prefix so they
 *    can never be confused with a project's `collabo_session` cookie;
 *  - no telemetry, no IP address storage;
 *  - its in-memory rate limiter off (it is useless across serverless instances); sign-in
 *    attempts are throttled by Collabo's Postgres-backed limiter in the router instead.
 *
 * Built per request: it needs this request's database connection and origin.
 */
export function createAdminAuth(db: Database, request: Request) {
  const origin = new URL(request.url).origin
  const secure = origin.startsWith('https://') || process.env.NODE_ENV === 'production'

  return betterAuth({
    appName: 'Collabo',
    secret: getAdminSecret(),
    baseURL: origin,
    basePath: '/api/auth',
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    logger: { level: 'error' },
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: adminUsers,
        session: adminSessions,
        account: adminAuthAccounts,
        verification: adminVerifications,
        twoFactor: adminTwoFactors,
      },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: 12,
      maxPasswordLength: 128,
      autoSignIn: false,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
    },
    session: { expiresIn: SESSION_SECONDS, updateAge: 60 * 15, freshAge: 60 * 10 },
    rateLimit: { enabled: false },
    advanced: {
      cookiePrefix: ADMIN_COOKIE_PREFIX,
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'strict', secure, path: '/' },
      ipAddress: { disableIpTracking: true },
    },
    plugins: [
      twoFactor({
        issuer: 'Collabo',
        // Five wrong codes in a row lock the account's second factor for 15 minutes,
        // whichever device or IP the guesses come from.
        accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      }),
    ],
    databaseHooks: {
      session: {
        create: {
          // A deactivated administrator can never obtain a new session.
          before: async (session) => {
            const account = await db.query.adminAccounts.findFirst({
              where: eq(adminAccounts.userId, session.userId),
              columns: { status: true },
            })
            if (!account || account.status !== 'active') return false
            return { data: session }
          },
        },
      },
    },
  })
}

export type AdminAuth = ReturnType<typeof createAdminAuth>
