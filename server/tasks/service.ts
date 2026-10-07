import { and, asc, desc, eq, sql } from 'drizzle-orm'
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core'
import type { z } from 'zod'
import type { createTaskSchema, updateTaskSchema } from '../../shared/schemas.js'
import type { ActivityDto, TaskDto } from '../../shared/types.js'
import type { Database } from '../db/client.js'
import { taskActivity, tasks } from '../db/schema.js'
import { ApiError } from '../errors.js'
import { assertActiveMember } from '../members/service.js'

type TaskRow = typeof tasks.$inferSelect
type TaskChanges = Partial<typeof tasks.$inferInsert>

export function toTaskDto(task: TaskRow): TaskDto {
  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignedToMemberId: task.assignedToMemberId,
    dueDate: task.dueDate,
    createdByMemberId: task.createdByMemberId,
    createdAt: task.createdAt.toISOString(),
    updatedByMemberId: task.updatedByMemberId,
    updatedAt: task.updatedAt.toISOString(),
    version: task.version,
    completedByMemberId: task.completedByMemberId,
    completedAt: task.completedAt?.toISOString() ?? null,
  }
}

function toActivityDto(row: typeof taskActivity.$inferSelect): ActivityDto {
  return {
    id: row.id,
    taskId: row.taskId,
    memberId: row.memberId,
    action: row.action,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    createdAt: row.createdAt.toISOString(),
  }
}

/** Every task lookup goes through here: the project comes from the session, never the client. */
function scoped(projectId: string, taskId: string) {
  return and(eq(tasks.id, taskId), eq(tasks.projectId, projectId))
}

export async function listTasks(db: Database, projectId: string): Promise<TaskDto[]> {
  const rows = await db.query.tasks.findMany({
    where: eq(tasks.projectId, projectId),
    orderBy: [desc(tasks.createdAt), desc(tasks.id)],
  })
  return rows.map(toTaskDto)
}

export async function getTask(db: Database, projectId: string, taskId: string): Promise<TaskDto> {
  const row = await db.query.tasks.findFirst({ where: scoped(projectId, taskId) })
  if (!row) throw new ApiError('TASK_NOT_FOUND')
  return toTaskDto(row)
}

export async function createTask(
  db: Database,
  projectId: string,
  actorId: string,
  input: z.output<typeof createTaskSchema>,
): Promise<TaskDto> {
  return db.transaction(async (tx) => {
    if (input.assignedToMemberId) {
      await assertActiveMember(tx, projectId, input.assignedToMemberId)
    }

    const [row] = await tx
      .insert(tasks)
      .values({
        projectId,
        title: input.title,
        description: input.description ?? null,
        priority: input.priority,
        assignedToMemberId: input.assignedToMemberId ?? null,
        dueDate: input.dueDate ?? null,
        createdByMemberId: actorId,
        updatedByMemberId: actorId,
      })
      .returning()
    if (!row) throw new Error('Task insert returned no row')

    await tx
      .insert(taskActivity)
      .values({ projectId, taskId: row.id, memberId: actorId, action: 'created' })

    return toTaskDto(row)
  })
}

/** Works out what an update actually changes, so no-op saves leave no trace. */
function diffTask(current: TaskRow, input: z.output<typeof updateTaskSchema>) {
  const fields: TaskChanges = {}
  let detailsChanged = false

  if (input.title !== undefined && input.title !== current.title) {
    fields.title = input.title
    detailsChanged = true
  }
  if (input.description !== undefined && input.description !== current.description) {
    fields.description = input.description
    detailsChanged = true
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    fields.priority = input.priority
    detailsChanged = true
  }
  if (input.assignedToMemberId !== undefined && input.assignedToMemberId !== current.assignedToMemberId) {
    fields.assignedToMemberId = input.assignedToMemberId
    detailsChanged = true
  }
  if (input.dueDate !== undefined && input.dueDate !== current.dueDate) {
    fields.dueDate = input.dueDate
    detailsChanged = true
  }

  const statusChanged = input.status !== undefined && input.status !== current.status
  return { fields, detailsChanged, statusChanged }
}

/**
 * Optimistic concurrency: the caller states which version it read. If someone
 * else has changed the task since, nothing is written and the result is
 * TASK_CONFLICT (409). The UPDATE repeats the version check in its WHERE
 * clause, so even a race between the read and the write cannot overwrite.
 */
export async function updateTask(
  db: Database,
  projectId: string,
  actorId: string,
  taskId: string,
  input: z.output<typeof updateTaskSchema>,
): Promise<TaskDto> {
  return db.transaction(async (tx) => {
    const current = await tx.query.tasks.findFirst({ where: scoped(projectId, taskId) })
    if (!current) throw new ApiError('TASK_NOT_FOUND')
    if (current.version !== input.expectedVersion) throw new ApiError('TASK_CONFLICT')

    const { fields, detailsChanged, statusChanged } = diffTask(current, input)
    if (!detailsChanged && !statusChanged) return toTaskDto(current)

    // Moving to a new assignee needs an active member; keeping a removed one is fine.
    if (fields.assignedToMemberId) {
      await assertActiveMember(tx, projectId, fields.assignedToMemberId)
    }

    const toStatus = input.status ?? current.status
    const completion: PgUpdateSetSource<typeof tasks> = !statusChanged
      ? {}
      : toStatus === 'completed'
        ? { completedByMemberId: actorId, completedAt: sql`now()` }
        : { completedByMemberId: null, completedAt: null }

    const [updated] = await tx
      .update(tasks)
      .set({
        ...fields,
        ...(statusChanged ? { status: toStatus } : {}),
        ...completion,
        version: sql`${tasks.version} + 1`,
        updatedAt: sql`now()`,
        updatedByMemberId: actorId,
      })
      .where(and(scoped(projectId, taskId), eq(tasks.version, input.expectedVersion)))
      .returning()
    if (!updated) throw new ApiError('TASK_CONFLICT')

    const activity: (typeof taskActivity.$inferInsert)[] = []
    if (detailsChanged) {
      activity.push({ projectId, taskId, memberId: actorId, action: 'updated' })
    }
    if (statusChanged) {
      activity.push({
        projectId,
        taskId,
        memberId: actorId,
        action: 'status_changed',
        fromStatus: current.status,
        toStatus,
      })
    }
    await tx.insert(taskActivity).values(activity)

    return toTaskDto(updated)
  })
}

export async function deleteTask(db: Database, projectId: string, taskId: string): Promise<void> {
  const deleted = await db.delete(tasks).where(scoped(projectId, taskId)).returning({ id: tasks.id })
  if (deleted.length === 0) throw new ApiError('TASK_NOT_FOUND')
}

export async function listActivity(
  db: Database,
  projectId: string,
  taskId: string,
): Promise<ActivityDto[]> {
  const task = await db.query.tasks.findFirst({
    where: scoped(projectId, taskId),
    columns: { id: true },
  })
  if (!task) throw new ApiError('TASK_NOT_FOUND')

  const rows = await db.query.taskActivity.findMany({
    where: and(eq(taskActivity.taskId, taskId), eq(taskActivity.projectId, projectId)),
    orderBy: [asc(taskActivity.createdAt), asc(taskActivity.id)],
  })
  return rows.map(toActivityDto)
}
