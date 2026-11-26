import { and, eq, sql } from 'drizzle-orm'
import type { TaskStatus } from '../../shared/constants.js'
import { aggregateStatus, ownProgressBlock } from '../../shared/task-progress.js'
import type { TaskDto } from '../../shared/types.js'
import { actorRef, type Scope } from '../actors.js'
import type { Database } from '../db/client.js'
import { taskAssignees } from '../db/schema.js'
import { ApiError } from '../errors.js'
import { recordActivity, type ActivityEvent } from './activity.js'
import { loadTask } from './dto.js'
import {
  activeAssignees,
  completionChange,
  lockTask,
  memberNames,
  requireReason,
  saveTask,
  type AssigneeRow,
  type TaskRow,
  type TaskSet,
} from './internal.js'
import { assertCanEditNote, prepareNoteChange } from './notes.js'

interface NoteInput {
  note?: string | undefined
  expectedNoteVersion?: number | undefined
}

/** Optionally replaces the shared note as part of a progress change (blank = leave it alone). */
async function maybeChangeNote(
  tx: Database,
  scope: Scope,
  task: TaskRow,
  assignees: readonly AssigneeRow[],
  input: NoteInput,
  reason: string | undefined,
): Promise<{ set: TaskSet; event: ActivityEvent | null }> {
  if (input.note === undefined) return { set: {}, event: null }
  assertCanEditNote(scope.actor, assignees)
  const prepared = await prepareNoteChange(tx, scope, task, {
    content: input.note,
    expectedNoteVersion: input.expectedNoteVersion ?? task.progressNoteVersion,
    reason,
  })
  return prepared ? { set: prepared.set, event: prepared.event } : { set: {}, event: null }
}

export interface SetStatusInput extends NoteInput {
  status: TaskStatus
  expectedAssigneeVersion: number
  reason?: string | undefined
}

/**
 * One person's own progress.
 *
 *  ALL  the person moves their own part between To Do / In Progress / Done; the task is
 *       done when everyone's part is.
 *  ANY  moving to In Progress is personal. Moving to Done completes the TASK for the group
 *       (and records who and when); the others' statuses stay exactly as they were. Once
 *       completed, nobody's progress changes until someone explicitly reopens it.
 *
 * People change only their own progress; an admin may change anyone's, with a reason.
 * The check is the assignee's own version, so teammates progressing concurrently do not
 * conflict with each other.
 */
export async function setAssigneeStatus(
  db: Database,
  scope: Scope,
  taskId: string,
  memberId: string,
  input: SetStatusInput,
): Promise<TaskDto> {
  await db.transaction(async (tx) => {
    const task = await lockTask(tx, scope.projectId, taskId)
    const assignees = await activeAssignees(tx, scope.projectId, taskId)
    const row = assignees.find((candidate) => candidate.memberId === memberId)
    if (!row) throw new ApiError('MEMBER_NOT_FOUND', { message: "That person isn't assigned to this task." })

    let reason: string | undefined
    if (scope.actor.type === 'member') {
      if (scope.actor.memberId !== memberId) {
        throw new ApiError('NOT_ASSIGNED', {
          message: 'Only that person (or a platform administrator) can change their progress.',
        })
      }
    } else {
      reason = requireReason(scope.actor, input.reason)
    }

    if (row.version !== input.expectedAssigneeVersion) throw new ApiError('ASSIGNEE_CONFLICT')
    if (ownProgressBlock(task.assignmentMode, task.status)) throw new ApiError('TASK_COMPLETED')
    if (row.status === input.status && input.note === undefined) return

    const note = await maybeChangeNote(tx, scope, task, assignees, input, reason)

    const events: ActivityEvent[] = []
    const ref = actorRef(scope.actor)
    let afterRows = assignees.map((candidate) => ({ status: candidate.status }))

    if (row.status !== input.status) {
      await tx
        .update(taskAssignees)
        .set({
          status: input.status,
          startedAt: row.startedAt ?? (input.status === 'todo' ? null : sql`now()`),
          completedAt: input.status === 'completed' ? sql`now()` : null,
          updatedAt: sql`now()`,
          updatedByMemberId: ref.memberId,
          updatedByAdminId: ref.adminId,
          version: sql`${taskAssignees.version} + 1`,
        })
        .where(and(eq(taskAssignees.id, row.id), eq(taskAssignees.version, row.version)))

      events.push({
        action: 'assignee_status_changed',
        subject: { memberId, name: (await memberNames(tx, scope.projectId, [memberId])).get(memberId) ?? '' },
        fromStatus: row.status,
        toStatus: input.status,
        details: reason ? { reason } : null,
      })
      afterRows = assignees.map((candidate) => ({
        status: candidate.memberId === memberId ? input.status : candidate.status,
      }))
    }

    // ANY: completing is a group decision recorded on the task; everything else is derived.
    const groupCompletion = task.assignmentMode === 'any' && input.status === 'completed'
    const status: TaskStatus = groupCompletion
      ? 'completed'
      : aggregateStatus(task.assignmentMode, task.status, afterRows)

    const set: TaskSet = { ...note.set }
    if (status !== task.status) {
      set.status = status
      Object.assign(set, completionChange(task.status, status, scope.actor))
      const trigger =
        status === 'completed'
          ? task.assignmentMode === 'any'
            ? ('group_completion' as const)
            : ('all_completed' as const)
          : task.status === 'completed'
            ? ('reopened' as const)
            : undefined
      events.push({
        action: 'status_changed',
        fromStatus: task.status,
        toStatus: status,
        details: trigger || reason ? { ...(trigger ? { trigger } : {}), ...(reason ? { reason } : {}) } : null,
      })
    }
    if (note.event) events.push(note.event)

    await saveTask(tx, scope, task, set)
    await recordActivity(tx, scope, taskId, events)
  })
  return loadTask(db, scope.projectId, scope.actor.type, taskId)
}

export interface ReopenInput extends NoteInput {
  expectedVersion: number
  reason?: string | undefined
}

/**
 * Explicitly reopens a task that was completed for the group (ANY mode). Nothing else
 * reopens it. The historical completion stays in the activity log; whoever had completed
 * goes back to In Progress, and the overall status follows from the assignees.
 */
export async function reopenTask(
  db: Database,
  scope: Scope,
  taskId: string,
  input: ReopenInput,
): Promise<TaskDto> {
  await db.transaction(async (tx) => {
    const task = await lockTask(tx, scope.projectId, taskId)
    if (task.version !== input.expectedVersion) throw new ApiError('TASK_CONFLICT')
    if (task.status !== 'completed') throw new ApiError('REOPEN_NOT_APPLICABLE')
    if (task.assignmentMode !== 'any') {
      throw new ApiError('REOPEN_NOT_APPLICABLE', {
        message: 'On a task where everyone completes their own part, reopen your own part instead.',
      })
    }

    const assignees = await activeAssignees(tx, scope.projectId, taskId)
    const reason = scope.actor.type === 'admin' ? requireReason(scope.actor, input.reason) : undefined
    if (scope.actor.type === 'member') {
      const actorId = scope.actor.memberId
      if (!assignees.some((row) => row.memberId === actorId)) throw new ApiError('NOT_ASSIGNED')
    }

    const note = await maybeChangeNote(tx, scope, task, assignees, input, reason)

    const ref = actorRef(scope.actor)
    const completedRows = assignees.filter((row) => row.status === 'completed')
    const names = await memberNames(
      tx,
      scope.projectId,
      completedRows.map((row) => row.memberId),
    )
    const events: ActivityEvent[] = []
    for (const row of completedRows) {
      await tx
        .update(taskAssignees)
        .set({
          status: 'in_progress',
          completedAt: null,
          updatedAt: sql`now()`,
          updatedByMemberId: ref.memberId,
          updatedByAdminId: ref.adminId,
          version: sql`${taskAssignees.version} + 1`,
        })
        .where(eq(taskAssignees.id, row.id))
      events.push({
        action: 'assignee_status_changed',
        subject: { memberId: row.memberId, name: names.get(row.memberId) ?? '' },
        fromStatus: 'completed',
        toStatus: 'in_progress',
        details: { trigger: 'reopened' },
      })
    }

    const after = assignees.map((row) => ({
      status: row.status === 'completed' ? ('in_progress' as const) : row.status,
    }))
    // Not completed any more, so the open-task rule applies.
    const status = aggregateStatus('any', 'todo', after)
    events.push({
      action: 'status_changed',
      fromStatus: 'completed',
      toStatus: status,
      details: { trigger: 'reopened', ...(reason ? { reason } : {}) },
    })

    await saveTask(tx, scope, task, {
      ...note.set,
      status,
      ...completionChange('completed', status, scope.actor),
    })
    if (note.event) events.push(note.event)
    await recordActivity(tx, scope, taskId, events)
  })
  return loadTask(db, scope.projectId, scope.actor.type, taskId)
}
