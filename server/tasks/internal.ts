import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import type { TaskStatus } from '../../shared/constants.js'
import type { DatedProgressRow } from '../../shared/task-progress.js'
import { actorRef, type Actor, type Scope } from '../actors.js'
import type { Database } from '../db/client.js'
import { members, taskAssignees, tasks } from '../db/schema.js'
import { ApiError } from '../errors.js'

export type TaskRow = typeof tasks.$inferSelect
export type AssigneeRow = typeof taskAssignees.$inferSelect
export type TaskSet = PgUpdateSetSource<typeof tasks>

/**
 * Loads a task of this project and locks it until the transaction ends. Every
 * mutation starts here, so changes to one task are applied one at a time and
 * each sees the latest committed state.
 */
export async function lockTask(db: Database, projectId: string, taskId: string): Promise<TaskRow> {
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId)))
    .for('update')
  if (!row) throw new ApiError('TASK_NOT_FOUND')
  return row
}

/** The people currently assigned (removed assignments are kept as history but excluded). */
export async function activeAssignees(
  db: Database,
  projectId: string,
  taskId: string,
): Promise<AssigneeRow[]> {
  return db
    .select()
    .from(taskAssignees)
    .where(
      and(
        eq(taskAssignees.taskId, taskId),
        eq(taskAssignees.projectId, projectId),
        isNull(taskAssignees.removedAt),
      ),
    )
    .orderBy(asc(taskAssignees.assignedAt), asc(taskAssignees.memberId))
}

export function asDated(row: AssigneeRow): DatedProgressRow {
  return {
    memberId: row.memberId,
    status: row.status,
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

/** Names of members of this project, by id. */
export async function memberNames(
  db: Database,
  projectId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(and(eq(members.projectId, projectId), inArray(members.id, unique)))
  return new Map(rows.map((row) => [row.id, row.name]))
}

/** Every id must be an active member of this project, otherwise nothing is assigned. */
export async function requireActiveMembers(
  db: Database,
  projectId: string,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return new Map()
  const rows = await db
    .select({ id: members.id, name: members.name })
    .from(members)
    .where(
      and(
        eq(members.projectId, projectId),
        eq(members.isActive, true),
        inArray(members.id, unique),
      ),
    )
  if (rows.length !== unique.length) throw new ApiError('MEMBER_NOT_FOUND')
  return new Map(rows.map((row) => [row.id, row.name]))
}

/**
 * Writes a change to the task row: bumps its version, stamps who changed it, and,
 * when the assignees changed, keeps the legacy single-assignee column equal to the
 * first active assignee. The version check cannot fail while the row is locked; it
 * is kept as a last line of defence.
 */
export async function saveTask(
  db: Database,
  scope: Scope,
  task: TaskRow,
  set: TaskSet,
  mirrorFirstAssignee?: string | null,
): Promise<TaskRow> {
  const ref = actorRef(scope.actor)
  const [row] = await db
    .update(tasks)
    .set({
      ...set,
      ...(mirrorFirstAssignee !== undefined ? { assignedToMemberId: mirrorFirstAssignee } : {}),
      version: sql`${tasks.version} + 1`,
      updatedAt: sql`now()`,
      updatedByMemberId: ref.memberId,
      updatedByAdminId: ref.adminId,
    })
    .where(
      and(eq(tasks.id, task.id), eq(tasks.projectId, task.projectId), eq(tasks.version, task.version)),
    )
    .returning()
  if (!row) throw new ApiError('TASK_CONFLICT')
  return row
}

/** Task columns that record the task becoming completed or being reopened. */
export function completionChange(before: TaskStatus, after: TaskStatus, actor: Actor): TaskSet {
  if (after === 'completed' && before !== 'completed') {
    const ref = actorRef(actor)
    return { completedAt: sql`now()`, completedByMemberId: ref.memberId, completedByAdminId: ref.adminId }
  }
  if (after !== 'completed' && before === 'completed') {
    return { completedAt: null, completedByMemberId: null, completedByAdminId: null }
  }
  return {}
}

/** The legacy single-assignee value: the earliest-assigned active member. */
export function firstAssignee(rows: readonly { memberId: string }[]): string | null {
  return rows[0]?.memberId ?? null
}

/** Admins must say why when they step into someone else's work. */
export function requireReason(actor: Actor, reason: string | undefined): string | undefined {
  if (actor.type === 'admin' && !reason) throw new ApiError('REASON_REQUIRED')
  return reason
}

/**
 * `assigned_at` for the nth person added in one statement. now() is the same for every
 * row of a transaction, so each is stamped 1ms apart (on the database clock) to keep the
 * order people were chosen in.
 */
export function assignedAtFor(index: number) {
  return sql`now() + ${index} * interval '1 millisecond'`
}
