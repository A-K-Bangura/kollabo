import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm'
import type { ActorType } from '../../shared/constants.js'
import type { AssigneeDto, TaskDto } from '../../shared/types.js'
import { toActorDto, type AdminNames } from '../actors.js'
import type { Database } from '../db/client.js'
import { adminUsers, members, taskAssignees, tasks } from '../db/schema.js'
import { ApiError } from '../errors.js'
import type { AssigneeRow, TaskRow } from './internal.js'

function toAssigneeDto(row: AssigneeRow): AssigneeDto {
  return {
    memberId: row.memberId,
    status: row.status,
    assignedAt: row.assignedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
    version: row.version,
  }
}

function toTaskDto(
  task: TaskRow,
  assignees: readonly AssigneeRow[],
  names: { members: ReadonlyMap<string, string>; admins?: AdminNames },
): TaskDto {
  const actor = (memberId: string | null, adminId: string | null) =>
    toActorDto({ memberId, adminId }, names)!

  return {
    id: task.id,
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    assignmentMode: task.assignmentMode,
    assignees: assignees.map(toAssigneeDto),
    assignedToMemberId: assignees[0]?.memberId ?? null,
    dueDate: task.dueDate,
    createdByMemberId: task.createdByMemberId,
    createdBy: actor(task.createdByMemberId, task.createdByAdminId),
    createdAt: task.createdAt.toISOString(),
    updatedByMemberId: task.updatedByMemberId,
    updatedBy: actor(task.updatedByMemberId, task.updatedByAdminId),
    updatedAt: task.updatedAt.toISOString(),
    version: task.version,
    completedByMemberId: task.completedByMemberId,
    completedBy:
      task.completedByMemberId || task.completedByAdminId
        ? actor(task.completedByMemberId, task.completedByAdminId)
        : null,
    completedAt: task.completedAt?.toISOString() ?? null,
    progressNote: task.progressNote,
    progressNoteVersion: task.progressNoteVersion,
    noteUpdatedAt: task.noteUpdatedAt?.toISOString() ?? null,
    noteUpdatedBy:
      task.noteUpdatedByMemberId || task.noteUpdatedByAdminId
        ? actor(task.noteUpdatedByMemberId, task.noteUpdatedByAdminId)
        : null,
  }
}

/**
 * Loads tasks of one project with their active assignees, in three queries however
 * many tasks there are. `viewer` controls whether administrators are identified.
 */
export async function loadTasks(
  db: Database,
  projectId: string,
  viewer: ActorType,
  taskIds?: readonly string[],
): Promise<TaskDto[]> {
  if (taskIds && taskIds.length === 0) return []

  const taskRows = await db
    .select()
    .from(tasks)
    .where(
      and(eq(tasks.projectId, projectId), taskIds ? inArray(tasks.id, [...taskIds]) : undefined),
    )
    .orderBy(desc(tasks.createdAt), desc(tasks.id))

  const assigneeRows = await db
    .select()
    .from(taskAssignees)
    .where(
      and(
        eq(taskAssignees.projectId, projectId),
        isNull(taskAssignees.removedAt),
        taskIds ? inArray(taskAssignees.taskId, [...taskIds]) : undefined,
      ),
    )
    .orderBy(asc(taskAssignees.assignedAt), asc(taskAssignees.memberId))

  const byTask = new Map<string, AssigneeRow[]>()
  for (const row of assigneeRows) {
    const list = byTask.get(row.taskId)
    if (list) list.push(row)
    else byTask.set(row.taskId, [row])
  }

  const memberIds = new Set<string>()
  const adminIds = new Set<string>()
  for (const task of taskRows) {
    for (const id of [
      task.createdByMemberId,
      task.updatedByMemberId,
      task.completedByMemberId,
      task.noteUpdatedByMemberId,
    ]) {
      if (id) memberIds.add(id)
    }
    for (const id of [
      task.createdByAdminId,
      task.updatedByAdminId,
      task.completedByAdminId,
      task.noteUpdatedByAdminId,
    ]) {
      if (id) adminIds.add(id)
    }
  }

  const memberRows =
    memberIds.size > 0
      ? await db
          .select({ id: members.id, name: members.name })
          .from(members)
          .where(and(eq(members.projectId, projectId), inArray(members.id, [...memberIds])))
      : []
  const adminRows =
    viewer === 'admin' && adminIds.size > 0
      ? await db
          .select({ id: adminUsers.id, name: adminUsers.name })
          .from(adminUsers)
          .where(inArray(adminUsers.id, [...adminIds]))
      : []

  const names = {
    members: new Map(memberRows.map((row) => [row.id, row.name])),
    admins: viewer === 'admin' ? new Map(adminRows.map((row) => [row.id, row.name])) : undefined,
  }
  return taskRows.map((task) => toTaskDto(task, byTask.get(task.id) ?? [], names))
}

export async function loadTask(
  db: Database,
  projectId: string,
  viewer: ActorType,
  taskId: string,
): Promise<TaskDto> {
  const [task] = await loadTasks(db, projectId, viewer, [taskId])
  if (!task) throw new ApiError('TASK_NOT_FOUND')
  return task
}
