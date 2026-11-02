import { and, desc, eq, sql } from 'drizzle-orm'
import type { z } from 'zod'
import type { adminAuditQuerySchema } from '../../shared/schemas.js'
import type { AdminAuditEntryDto, Paged } from '../../shared/types.js'
import type { AuditEntry } from '../access.js'
import type { Database } from '../db/client.js'
import { adminAuditLogs } from '../db/schema.js'

/** The administrator an audit row names. Name and email are copied, so the trail survives later renames. */
export interface AuditActor {
  adminId: string
  name: string
  email: string
}

export interface AuditInput extends AuditEntry {
  projectId?: string | null
}

/** Keys that must never be written to the log, even if a caller puts them in a summary by mistake. */
const SECRET_KEY = /code|password|secret|token|hash|cookie|backup/i

/** Drops anything that looks like a credential, however deeply nested. Defence in depth: callers should not pass secrets at all. */
export function scrubSummary(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => scrubSummary(item, depth + 1))
  if (value && typeof value === 'object') {
    if (depth > 4) return undefined
    const out: Record<string, unknown> = {}
    for (const [key, inner] of Object.entries(value)) {
      if (SECRET_KEY.test(key)) continue
      out[key] = scrubSummary(inner, depth + 1)
    }
    return out
  }
  return typeof value === 'string' && value.length > 500 ? `${value.slice(0, 500)}…` : value
}

/**
 * Appends one row to the admin audit log. Admin routes call this in the same transaction
 * as the change it describes, so a change and its record succeed or fail together.
 * The table itself refuses UPDATE, DELETE and TRUNCATE (migration 0003).
 */
export async function writeAudit(db: Database, admin: AuditActor, input: AuditInput): Promise<void> {
  const summary = input.summary ? scrubSummary(input.summary) : null
  await db.insert(adminAuditLogs).values({
    adminId: admin.adminId,
    adminName: admin.name,
    adminEmail: admin.email,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    projectId: input.projectId ?? null,
    reason: input.reason ?? null,
    summary: summary as Record<string, unknown> | null,
  })
}

export async function listAudit(
  db: Database,
  query: z.output<typeof adminAuditQuerySchema>,
): Promise<Paged<AdminAuditEntryDto>> {
  const where = and(
    query.projectId ? eq(adminAuditLogs.projectId, query.projectId) : undefined,
    query.adminId ? eq(adminAuditLogs.adminId, query.adminId) : undefined,
    query.action ? eq(adminAuditLogs.action, query.action) : undefined,
  )

  const rows = await db
    .select()
    .from(adminAuditLogs)
    .where(where)
    .orderBy(desc(adminAuditLogs.createdAt), desc(adminAuditLogs.id))
    .limit(query.limit + 1)
    .offset((query.page - 1) * query.limit)

  const [totalRow] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(adminAuditLogs)
    .where(where)

  const items: AdminAuditEntryDto[] = rows.slice(0, query.limit).map((row) => ({
    id: row.id,
    adminId: row.adminId,
    adminName: row.adminName,
    adminEmail: row.adminEmail,
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    projectId: row.projectId,
    reason: row.reason,
    summary: (row.summary as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
  }))
  return {
    items,
    page: query.page,
    pageSize: query.limit,
    total: totalRow?.total ?? items.length,
    hasMore: rows.length > query.limit,
  }
}
