import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm'
import type { MemberDto } from '../../shared/types.js'
import type { Scope } from '../actors.js'
import type { Database } from '../db/client.js'
import { members, taskAssignees, tasks } from '../db/schema.js'
import { ApiError } from '../errors.js'
import { recordActivity } from '../tasks/activity.js'
import { applyAssignmentChange } from '../tasks/assignment.js'
import { activeAssignees, lockTask, saveTask } from '../tasks/internal.js'

export function toMemberDto(member: typeof members.$inferSelect): MemberDto {
  return {
    id: member.id,
    name: member.name,
    isActive: member.isActive,
    createdAt: member.createdAt.toISOString(),
  }
}

/** Every member, including removed ones, so old tasks and activity still resolve a name. */
export async function listMembers(db: Database, projectId: string): Promise<MemberDto[]> {
  const rows = await db.query.members.findMany({
    where: eq(members.projectId, projectId),
    orderBy: [asc(members.createdAt), asc(members.id)],
  })
  return rows.map(toMemberDto)
}

export interface AddMembersResult {
  members: MemberDto[]
  /** Names that were not added because someone with that name is already active. */
  skipped: string[]
}

/**
 * Adds people, or brings back previously removed ones with the same name. In strict
 * mode (a single name typed by hand) an existing active member is an error; in bulk
 * mode (a pasted list) duplicates are reported back and skipped.
 */
export async function addMembers(
  db: Database,
  projectId: string,
  names: readonly string[],
  options: { strict: boolean },
): Promise<AddMembersResult> {
  const seen = new Set<string>()
  const wanted = names.filter((name) => {
    const key = name.toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(members)
      .where(
        and(eq(members.projectId, projectId), inArray(sql`lower(${members.name})`, [...seen])),
      )
    const byKey = new Map(existing.map((row) => [row.name.toLowerCase(), row]))

    const result: MemberDto[] = []
    const skipped: string[] = []
    const fresh: string[] = []

    for (const name of wanted) {
      const match = byKey.get(name.toLowerCase())
      if (!match) {
        fresh.push(name)
      } else if (match.isActive) {
        if (options.strict) throw new ApiError('MEMBER_EXISTS')
        skipped.push(name)
      } else {
        const [revived] = await tx
          .update(members)
          .set({ isActive: true, deactivatedAt: null, updatedAt: sql`now()` })
          .where(and(eq(members.id, match.id), eq(members.projectId, projectId)))
          .returning()
        if (revived) result.push(toMemberDto(revived))
      }
    }

    if (fresh.length > 0) {
      // now() is identical for every row of one statement, so stamp each member 1ms
      // apart to keep the order the names were entered in.
      const firstStamp = Date.now()
      const inserted = await tx
        .insert(members)
        .values(fresh.map((name, index) => ({ projectId, name, createdAt: new Date(firstStamp + index) })))
        .onConflictDoNothing()
        .returning()
      // Someone added the same name at the same moment: the unique index decided.
      const insertedKeys = new Set(inserted.map((row) => row.name.toLowerCase()))
      for (const name of fresh) {
        if (!insertedKeys.has(name.toLowerCase())) {
          if (options.strict) throw new ApiError('MEMBER_EXISTS')
          skipped.push(name)
        }
      }
      result.push(...inserted.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()).map(toMemberDto))
    }

    return { members: result, skipped }
  })
}

/** Renames a member. History keeps the names people had when they acted. */
export async function renameMember(
  db: Database,
  projectId: string,
  memberId: string,
  name: string,
): Promise<MemberDto> {
  const clash = await db.query.members.findFirst({
    where: and(
      eq(members.projectId, projectId),
      sql`lower(${members.name}) = lower(${name})`,
      ne(members.id, memberId),
    ),
    columns: { id: true },
  })
  if (clash) throw new ApiError('MEMBER_EXISTS')

  const [row] = await db
    .update(members)
    .set({ name, updatedAt: sql`now()` })
    .where(and(eq(members.id, memberId), eq(members.projectId, projectId)))
    .returning()
  if (!row) throw new ApiError('MEMBER_NOT_FOUND')
  return toMemberDto(row)
}

export async function reactivateMember(
  db: Database,
  projectId: string,
  memberId: string,
): Promise<MemberDto> {
  const [row] = await db
    .update(members)
    .set({ isActive: true, deactivatedAt: null, updatedAt: sql`now()` })
    .where(and(eq(members.id, memberId), eq(members.projectId, projectId)))
    .returning()
  if (!row) throw new ApiError('MEMBER_NOT_FOUND')
  return toMemberDto(row)
}

export interface DeactivationResolution {
  /**
   * What to do with the person's unfinished tasks.
   *  undefined  nothing decided: refused if they have any (409 MEMBER_HAS_OPEN_TASKS)
   *  a member   that member takes over (and is added where not already assigned)
   *  null       just remove them: only possible where other assignees remain
   */
  reassignToMemberId?: string | null | undefined
}

/**
 * Soft-removes a member. They are kept (so history keeps their name) but can no longer
 * act or be assigned. Active work never becomes unfinishable: unfinished tasks must be
 * explicitly resolved first, and the whole thing is atomic, so a refusal changes nothing.
 * The last active member can never be removed.
 */
export async function deactivateMember(
  db: Database,
  scope: Scope,
  memberId: string,
  resolution: DeactivationResolution,
): Promise<void> {
  await db.transaction(async (tx) => {
    // Locking the active set makes simultaneous removals take turns.
    const active = await tx
      .select({ id: members.id })
      .from(members)
      .where(and(eq(members.projectId, scope.projectId), eq(members.isActive, true)))
      .for('update')

    const target = await tx.query.members.findFirst({
      where: and(eq(members.id, memberId), eq(members.projectId, scope.projectId)),
    })
    if (!target) throw new ApiError('MEMBER_NOT_FOUND')
    if (!target.isActive) return
    if (active.length <= 1) throw new ApiError('LAST_MEMBER')

    // A hand-over target must be a different, active member of this project, whether or not
    // there turns out to be anything to hand over.
    const reassignTo = resolution.reassignToMemberId
    if (reassignTo) {
      if (reassignTo === memberId || !active.some((row) => row.id === reassignTo)) {
        throw new ApiError('MEMBER_NOT_FOUND')
      }
    }

    const open = await tx
      .select({ taskId: taskAssignees.taskId, title: tasks.title })
      .from(taskAssignees)
      .innerJoin(tasks, and(eq(tasks.id, taskAssignees.taskId), eq(tasks.projectId, taskAssignees.projectId)))
      .where(
        and(
          eq(taskAssignees.projectId, scope.projectId),
          eq(taskAssignees.memberId, memberId),
          isNull(taskAssignees.removedAt),
          ne(tasks.status, 'completed'),
        ),
      )
      .orderBy(asc(tasks.id))

    if (open.length > 0) {
      const sole = await soleAssigneeTasks(tx, scope.projectId, open.map((row) => row.taskId))
      const refuse = () =>
        new ApiError('MEMBER_HAS_OPEN_TASKS', {
          details: {
            total: open.length,
            tasks: open
              .slice(0, 20)
              .map((row) => ({ id: row.taskId, title: row.title, onlyAssignee: sole.has(row.taskId) })),
          },
        })

      if (reassignTo === undefined) throw refuse()
      if (reassignTo === null && sole.size > 0) throw refuse()

      for (const { taskId } of open) {
        const task = await lockTask(tx, scope.projectId, taskId)
        if (task.status === 'completed') continue // finished while we were deciding
        const assignees = await activeAssignees(tx, scope.projectId, taskId)
        if (!assignees.some((row) => row.memberId === memberId)) continue
        const result = await applyAssignmentChange(tx, scope, task, assignees, {
          add: reassignTo ? [reassignTo] : [],
          remove: [memberId],
        })
        await saveTask(tx, scope, task, result.set, result.mirror)
        await recordActivity(tx, scope, taskId, result.events)
      }
    }

    await tx
      .update(members)
      .set({ isActive: false, deactivatedAt: sql`now()`, updatedAt: sql`now()` })
      .where(and(eq(members.id, memberId), eq(members.projectId, scope.projectId)))
  })
}

/** The tasks (of these) that have exactly one active assignee. */
async function soleAssigneeTasks(
  db: Database,
  projectId: string,
  taskIds: readonly string[],
): Promise<Set<string>> {
  const rows = await db
    .select({ taskId: taskAssignees.taskId, n: count() })
    .from(taskAssignees)
    .where(
      and(
        eq(taskAssignees.projectId, projectId),
        isNull(taskAssignees.removedAt),
        inArray(taskAssignees.taskId, [...taskIds]),
      ),
    )
    .groupBy(taskAssignees.taskId)
  return new Set(rows.filter((row) => row.n === 1).map((row) => row.taskId))
}
