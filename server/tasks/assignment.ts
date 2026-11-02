import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { AssignmentMode, TaskStatus } from '../../shared/constants.js'
import {
  aggregateStatus,
  hasProgress,
  latestCompleter,
  statusAfterModeChange,
} from '../../shared/task-progress.js'
import { actorRef, type Scope } from '../actors.js'
import type { Database } from '../db/client.js'
import { taskAssignees } from '../db/schema.js'
import { ApiError } from '../errors.js'
import type { ActivityEvent } from './activity.js'
import {
  asDated,
  assignedAtFor,
  completionChange,
  firstAssignee,
  memberNames,
  requireActiveMembers,
  type AssigneeRow,
  type TaskRow,
  type TaskSet,
} from './internal.js'

export interface AssignmentChange {
  /** Members to add. Anyone already assigned is ignored. */
  add: readonly string[]
  /** Members to remove (their history is kept). */
  remove: readonly string[]
  mode?: AssignmentMode | undefined
  /** Needed to switch modes once the task has any progress. */
  confirmModeChange?: boolean | undefined
}

export interface AssignmentResult {
  /** Task columns to merge into the task update (mode, status, completion). */
  set: TaskSet
  events: ActivityEvent[]
  /** The legacy single-assignee mirror value for the task row. */
  mirror: string | null
  /** Overall status after the change. */
  status: TaskStatus
  changed: boolean
}

/**
 * Applies a change to who is assigned and/or the completion mode, inside the caller's
 * transaction (the task must be locked). It writes the assignee rows and returns the
 * task columns and activity events; the caller writes the task row once, so one user
 * action is one version bump.
 *
 * Status follows shared/task-progress.ts, so the same rules apply whether the change
 * is an edit, a reassignment, or a member being deactivated:
 *  - adding an unfinished person to a completed ALL task reopens it,
 *  - removing people recalculates progress (never below one assignee),
 *  - a completed ANY task stays completed until explicitly reopened,
 *  - a mode switch on a task with progress must be confirmed.
 */
export async function applyAssignmentChange(
  db: Database,
  scope: Scope,
  task: TaskRow,
  current: readonly AssigneeRow[],
  change: AssignmentChange,
): Promise<AssignmentResult> {
  const currentIds = new Set(current.map((row) => row.memberId))
  const toAdd = [...new Set(change.add)].filter((id) => !currentIds.has(id))
  const removeSet = new Set(change.remove.filter((id) => currentIds.has(id)))
  const toRemove = current.filter((row) => removeSet.has(row.memberId))
  const kept = current.filter((row) => !removeSet.has(row.memberId))

  const addedNames = await requireActiveMembers(db, scope.projectId, toAdd)
  const removedNames = await memberNames(
    db,
    scope.projectId,
    toRemove.map((row) => row.memberId),
  )

  const afterRows = [
    ...kept.map(asDated),
    ...toAdd.map((memberId) => ({ memberId, status: 'todo' as TaskStatus, completedAt: null })),
  ]
  if (afterRows.length === 0) throw new ApiError('LAST_ASSIGNEE')

  const fromMode = task.assignmentMode
  const toMode = change.mode ?? fromMode
  const modeChanged = fromMode !== toMode
  const status = modeChanged
    ? statusAfterModeChange(fromMode, toMode, task.status, afterRows)
    : aggregateStatus(fromMode, task.status, afterRows)

  if (modeChanged && hasProgress(task.status, current.map(asDated)) && !change.confirmModeChange) {
    throw new ApiError('MODE_CHANGE_NEEDS_CONFIRMATION', {
      details: { fromMode, toMode, fromStatus: task.status, toStatus: status },
    })
  }

  const ref = actorRef(scope.actor)
  if (toAdd.length > 0) {
    await db.insert(taskAssignees).values(
      toAdd.map((memberId, index) => ({
        projectId: scope.projectId,
        taskId: task.id,
        memberId,
        assignedAt: assignedAtFor(index),
        assignedByMemberId: ref.memberId,
        assignedByAdminId: ref.adminId,
        updatedByMemberId: ref.memberId,
        updatedByAdminId: ref.adminId,
      })),
    )
  }
  if (toRemove.length > 0) {
    await db
      .update(taskAssignees)
      .set({ removedAt: sql`now()`, updatedAt: sql`now()` })
      .where(
        and(
          eq(taskAssignees.taskId, task.id),
          eq(taskAssignees.projectId, scope.projectId),
          isNull(taskAssignees.removedAt),
          inArray(
            taskAssignees.memberId,
            toRemove.map((row) => row.memberId),
          ),
        ),
      )
  }

  const events: ActivityEvent[] = []
  for (const memberId of toAdd) {
    events.push({ action: 'assignee_added', subject: { memberId, name: addedNames.get(memberId) ?? '' } })
  }
  for (const row of toRemove) {
    events.push({
      action: 'assignee_removed',
      subject: { memberId: row.memberId, name: removedNames.get(row.memberId) ?? '' },
    })
  }
  if (modeChanged) {
    events.push({
      action: 'mode_changed',
      details: { fromMode, toMode },
    })
  }

  const set: TaskSet = {}
  if (modeChanged) set.assignmentMode = toMode

  if (status !== task.status) {
    events.push({
      action: 'status_changed',
      fromStatus: task.status,
      toStatus: status,
      details: {
        trigger: modeChanged ? 'mode_changed' : toAdd.length > 0 && toRemove.length === 0 ? 'assignee_added' : 'assignee_removed',
      },
    })
    set.status = status

    // Completed by a mode switch from work somebody already finished: that person's completion
    // is the task's completion. Otherwise whoever made this change completed it.
    const earlier = status === 'completed' && modeChanged ? latestCompleter(afterRows) : null
    if (earlier && task.status !== 'completed') {
      set.completedAt = earlier.completedAt ? new Date(earlier.completedAt) : sql`now()`
      set.completedByMemberId = earlier.memberId
      set.completedByAdminId = null
    } else {
      Object.assign(set, completionChange(task.status, status, scope.actor))
    }
  }

  const ordered = [...kept, ...toAdd.map((memberId) => ({ memberId }))]
  return {
    set,
    events,
    mirror: firstAssignee(ordered),
    status,
    changed: toAdd.length > 0 || toRemove.length > 0 || modeChanged,
  }
}
