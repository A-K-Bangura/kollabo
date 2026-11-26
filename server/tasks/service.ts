import { and, eq } from 'drizzle-orm'
import type { z } from 'zod'
import type { createTaskSchema, updateTaskSchema } from '../../shared/schemas.js'
import type { ActivityDetails, TaskDto } from '../../shared/types.js'
import { actorRef, type ReadScope, type Scope } from '../actors.js'
import type { Database } from '../db/client.js'
import { taskAssignees, tasks } from '../db/schema.js'
import { ApiError } from '../errors.js'
import { recordActivity, type ActivityEvent } from './activity.js'
import { applyAssignmentChange } from './assignment.js'
import { loadTask, loadTasks } from './dto.js'
import {
  activeAssignees,
  assignedAtFor,
  lockTask,
  requireActiveMembers,
  requireReason,
  saveTask,
  type TaskRow,
  type TaskSet,
} from './internal.js'

export { editNote, clearNote, listRevisions } from './notes.js'
export { reopenTask, setAssigneeStatus } from './progress.js'
export { listActivity } from './activity.js'

export function listTasks(db: Database, scope: ReadScope): Promise<TaskDto[]> {
  return loadTasks(db, scope.projectId, scope.viewer)
}

export function getTask(db: Database, scope: ReadScope, taskId: string): Promise<TaskDto> {
  return loadTask(db, scope.projectId, scope.viewer, taskId)
}

/** A task starts with its assignees (at least one) all To Do, in the chosen completion mode. */
export async function createTask(
  db: Database,
  scope: Scope,
  input: z.output<typeof createTaskSchema>,
): Promise<TaskDto> {
  const assigneeIds = [
    ...new Set(input.assigneeIds ?? (input.assignedToMemberId ? [input.assignedToMemberId] : [])),
  ]

  const taskId = await db.transaction(async (tx) => {
    const names = await requireActiveMembers(tx, scope.projectId, assigneeIds)
    const ref = actorRef(scope.actor)

    const [row] = await tx
      .insert(tasks)
      .values({
        projectId: scope.projectId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        assignmentMode: input.assignmentMode,
        dueDate: input.dueDate ?? null,
        assignedToMemberId: assigneeIds[0] ?? null,
        createdByMemberId: ref.memberId,
        createdByAdminId: ref.adminId,
        updatedByMemberId: ref.memberId,
        updatedByAdminId: ref.adminId,
      })
      .returning()
    if (!row) throw new Error('Task insert returned no row')

    await tx.insert(taskAssignees).values(
      assigneeIds.map((memberId, index) => ({
        projectId: scope.projectId,
        taskId: row.id,
        memberId,
        assignedAt: assignedAtFor(index),
        assignedByMemberId: ref.memberId,
        assignedByAdminId: ref.adminId,
        updatedByMemberId: ref.memberId,
        updatedByAdminId: ref.adminId,
      })),
    )

    await recordActivity(tx, scope, row.id, [
      { action: 'created', details: { toMode: input.assignmentMode } },
      ...assigneeIds.map((memberId) => ({
        action: 'assignee_added' as const,
        subject: { memberId, name: names.get(memberId) ?? '' },
      })),
    ])
    return row.id
  })

  return loadTask(db, scope.projectId, scope.actor.type, taskId)
}

/** Works out what a details edit actually changes, so no-op saves leave no trace. */
function diffDetails(current: TaskRow, input: z.output<typeof updateTaskSchema>): TaskSet {
  const set: TaskSet = {}
  if (input.title !== undefined && input.title !== current.title) set.title = input.title
  if (input.description !== undefined && input.description !== current.description) {
    set.description = input.description
  }
  if (input.priority !== undefined && input.priority !== current.priority) set.priority = input.priority
  if (input.dueDate !== undefined && input.dueDate !== current.dueDate) set.dueDate = input.dueDate
  return set
}

/**
 * Edits the task: its details, who is assigned, and who must complete it. A stale
 * `expectedVersion` returns 409 and writes nothing. Everything (assignee rows, status
 * recalculation, history) commits together or not at all.
 */
export async function updateTask(
  db: Database,
  scope: Scope,
  taskId: string,
  input: z.output<typeof updateTaskSchema>,
): Promise<TaskDto> {
  await db.transaction(async (tx) => {
    const task = await lockTask(tx, scope.projectId, taskId)
    if (task.version !== input.expectedVersion) throw new ApiError('TASK_CONFLICT')

    const current = await activeAssignees(tx, scope.projectId, taskId)
    const desired =
      input.assigneeIds ?? (input.assignedToMemberId ? [input.assignedToMemberId] : undefined)
    const currentIds = new Set(current.map((row) => row.memberId))

    const detailSet = diffDetails(task, input)
    const change = {
      add: desired ? desired.filter((id) => !currentIds.has(id)) : [],
      remove: desired ? [...currentIds].filter((id) => !desired.includes(id)) : [],
      mode: input.assignmentMode,
      confirmModeChange: input.confirmModeChange,
    }

    const modeChanged = input.assignmentMode !== undefined && input.assignmentMode !== task.assignmentMode
    const assignmentTouched = change.add.length > 0 || change.remove.length > 0 || modeChanged
    const detailsTouched = Object.keys(detailSet).length > 0
    if (!assignmentTouched && !detailsTouched) return

    const reason = scope.actor.type === 'admin' ? input.reason : undefined
    const events: ActivityEvent[] = []
    const set: TaskSet = { ...detailSet }
    let mirror: string | null | undefined

    if (assignmentTouched) {
      const result = await applyAssignmentChange(tx, scope, task, current, change)
      Object.assign(set, result.set)
      events.push(...result.events)
      mirror = result.mirror
    }
    if (detailsTouched) {
      // Which fields changed (never their text), plus the due date itself: a deadline moving is
      // exactly what a future reminder system would need to notice, and a date is not sensitive.
      const details: ActivityDetails = {
        changed: Object.keys(detailSet),
        ...(detailSet.dueDate !== undefined ? { dueDate: { from: task.dueDate, to: input.dueDate ?? null } } : {}),
        ...(reason ? { reason } : {}),
      }
      events.unshift({ action: 'updated', details })
    }

    await saveTask(tx, scope, task, set, mirror)
    await recordActivity(tx, scope, taskId, events)
  })
  return loadTask(db, scope.projectId, scope.actor.type, taskId)
}

/** Removes the task and its history. Members may; an admin must say why. */
export async function deleteTask(
  db: Database,
  scope: Scope,
  taskId: string,
  options: { reason?: string | undefined } = {},
): Promise<{ id: string; title: string }> {
  requireReason(scope.actor, options.reason)
  const [deleted] = await db
    .delete(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, scope.projectId)))
    .returning({ id: tasks.id, title: tasks.title })
  if (!deleted) throw new ApiError('TASK_NOT_FOUND')
  return deleted
}
