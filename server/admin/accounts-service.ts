import { randomBytes, randomUUID } from 'node:crypto'
import { hashPassword } from 'better-auth/crypto'
import { asc, eq, sql } from 'drizzle-orm'
import type { AdminAccountDto } from '../../shared/types.js'
import type { Database } from '../db/client.js'
import {
  adminAccounts,
  adminAuthAccounts,
  adminSessions,
  adminTwoFactors,
  adminUsers,
} from '../db/schema.js'
import { ApiError, pgErrorCode, UNIQUE_VIOLATION } from '../errors.js'

export const MIN_ADMIN_PASSWORD_LENGTH = 12

/** A strong one-time password (144 bits). Shown once to whoever creates the account, then forgotten. */
export function generateTemporaryPassword(): string {
  return randomBytes(18).toString('base64url')
}

interface NewAdmin {
  name: string
  email: string
  password: string
  /** True when someone else chose the password: the person must replace it before using the admin area. */
  mustChangePassword: boolean
  createdByAdminId?: string | null
}

/**
 * Creates an administrator: the sign-in identity (for the auth library), its credential
 * (a salted scrypt hash, produced by the library's own function), and Collabo's status
 * record. This is the single code path behind both the bootstrap script and the
 * "add administrator" screen, so there is exactly one way an admin comes to exist.
 */
export async function createAdminAccount(db: Database, input: NewAdmin): Promise<AdminAccountDto> {
  if (input.password.length < MIN_ADMIN_PASSWORD_LENGTH) {
    throw new ApiError('VALIDATION_ERROR', {
      message: `Passwords need at least ${MIN_ADMIN_PASSWORD_LENGTH} characters.`,
    })
  }
  const id = randomUUID()
  const email = input.email.trim().toLowerCase()
  const passwordHash = await hashPassword(input.password)

  try {
    await db.transaction(async (tx) => {
      await tx.insert(adminUsers).values({ id, name: input.name, email, emailVerified: true })
      await tx.insert(adminAuthAccounts).values({
        id: randomUUID(),
        accountId: id,
        providerId: 'credential',
        userId: id,
        password: passwordHash,
      })
      await tx.insert(adminAccounts).values({
        userId: id,
        mustChangePassword: input.mustChangePassword,
        createdByAdminId: input.createdByAdminId ?? null,
      })
    })
  } catch (error) {
    if (pgErrorCode(error) === UNIQUE_VIOLATION) throw new ApiError('ADMIN_EXISTS')
    throw error
  }

  return {
    id,
    name: input.name,
    email,
    status: 'active',
    twoFactorEnabled: false,
    mustChangePassword: input.mustChangePassword,
    createdAt: new Date().toISOString(),
  }
}

export async function listAdmins(db: Database): Promise<AdminAccountDto[]> {
  const rows = await db
    .select({
      id: adminUsers.id,
      name: adminUsers.name,
      email: adminUsers.email,
      status: adminAccounts.status,
      twoFactorEnabled: adminUsers.twoFactorEnabled,
      mustChangePassword: adminAccounts.mustChangePassword,
      createdAt: adminAccounts.createdAt,
    })
    .from(adminAccounts)
    .innerJoin(adminUsers, eq(adminUsers.id, adminAccounts.userId))
    .orderBy(asc(adminAccounts.createdAt), asc(adminUsers.id))
  return rows.map((row) => ({
    ...row,
    twoFactorEnabled: row.twoFactorEnabled === true,
    createdAt: row.createdAt.toISOString(),
  }))
}

/**
 * Deactivates or reactivates an administrator. Deactivation also ends all of their
 * sessions at once. An administrator cannot lock themselves out, and the last active
 * administrator can never be deactivated (the rows are locked while counting so two
 * admins deactivating each other at the same moment cannot empty the table).
 */
export async function setAdminActive(
  db: Database,
  actingAdminId: string,
  targetId: string,
  active: boolean,
): Promise<AdminAccountDto> {
  return db.transaction(async (tx) => {
    const activeRows = await tx
      .select({ userId: adminAccounts.userId })
      .from(adminAccounts)
      .where(eq(adminAccounts.status, 'active'))
      .for('update')

    const target = await tx.query.adminAccounts.findFirst({
      where: eq(adminAccounts.userId, targetId),
      columns: { status: true },
    })
    if (!target) throw new ApiError('NOT_FOUND', { message: 'No such administrator.' })

    if (!active) {
      if (targetId === actingAdminId) {
        throw new ApiError('ADMIN_FORBIDDEN', { message: 'You cannot deactivate your own account.' })
      }
      if (target.status === 'active' && activeRows.length <= 1) {
        throw new ApiError('ADMIN_FORBIDDEN', {
          message: 'At least one active administrator must remain.',
        })
      }
    }

    await tx
      .update(adminAccounts)
      .set(
        active
          ? { status: 'active', deactivatedAt: null, deactivatedByAdminId: null }
          : { status: 'deactivated', deactivatedAt: sql`now()`, deactivatedByAdminId: actingAdminId },
      )
      .where(eq(adminAccounts.userId, targetId))
    if (!active) await tx.delete(adminSessions).where(eq(adminSessions.userId, targetId))

    const [updated] = (await listAdminsWhere(tx, targetId))
    if (!updated) throw new ApiError('NOT_FOUND')
    return updated
  })
}

async function listAdminsWhere(db: Database, id: string): Promise<AdminAccountDto[]> {
  return (await listAdmins(db)).filter((admin) => admin.id === id)
}

/**
 * Removes an administrator's authenticator and signs them out everywhere, so they enrol a
 * new device at next sign-in. Operator-only (command line): a lost authenticator is
 * exactly the situation in which the person cannot be trusted to use the web UI.
 */
export async function resetAdminTwoFactor(db: Database, email: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const user = await tx.query.adminUsers.findFirst({
      where: eq(adminUsers.email, email.trim().toLowerCase()),
      columns: { id: true },
    })
    if (!user) return false
    await tx.delete(adminTwoFactors).where(eq(adminTwoFactors.userId, user.id))
    await tx.update(adminUsers).set({ twoFactorEnabled: false }).where(eq(adminUsers.id, user.id))
    await tx.delete(adminSessions).where(eq(adminSessions.userId, user.id))
    return true
  })
}
