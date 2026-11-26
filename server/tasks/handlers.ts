import { z } from 'zod'
import {
  createTaskSchema,
  editNoteSchema,
  historyQuerySchema,
  reasonSchema,
  reopenTaskSchema,
  setAssigneeStatusSchema,
  updateTaskSchema,
} from '../../shared/schemas.js'
import { scopeOf, type AccessHandler } from '../access.js'
import { json, noContent, parseId, parseQuery, readJson } from '../http.js'
import { summarizeTaskChange } from './audit-summary.js'
import {
  clearNote,
  createTask,
  deleteTask,
  editNote,
  getTask,
  listActivity,
  listRevisions,
  listTasks,
  reopenTask,
  setAssigneeStatus,
  updateTask,
} from './service.js'

/**
 * These handlers serve both project members (/api/tasks/...) and platform admins
 * (/api/admin/projects/:projectId/tasks/...). They only ever act on `access.projectId`,
 * which comes from the verified session or the admin route, never from the request body.
 */

const reader = (access: { projectId: string; viewer: 'member' | 'admin' }) => ({
  projectId: access.projectId,
  viewer: access.viewer,
})

export const listTasksHandler: AccessHandler = async (ctx, access) =>
  json({ tasks: await listTasks(ctx.db, reader(access)) })

export const getTaskHandler: AccessHandler = async (ctx, access) =>
  json({ task: await getTask(ctx.db, reader(access), parseId(ctx.params.id)) })

export const createTaskHandler: AccessHandler = async (ctx, access) => {
  const input = await readJson(ctx.request, createTaskSchema)
  const task = await createTask(ctx.db, await scopeOf(access), input)
  await access.audit?.({
    action: 'task.create',
    targetType: 'task',
    targetId: task.id,
    summary: { title: task.title, mode: task.assignmentMode, assignees: task.assignees.length },
  })
  return json({ task }, { status: 201 })
}

export const updateTaskHandler: AccessHandler = async (ctx, access) => {
  const taskId = parseId(ctx.params.id)
  const input = await readJson(ctx.request, updateTaskSchema)
  const scope = await scopeOf(access)
  const before = access.audit ? await getTask(ctx.db, reader(access), taskId) : null
  const task = await updateTask(ctx.db, scope, taskId, input)
  if (before) {
    await access.audit?.({
      action: 'task.update',
      targetType: 'task',
      targetId: task.id,
      reason: input.reason ?? null,
      summary: summarizeTaskChange(before, task),
    })
  }
  return json({ task })
}

const deleteQuerySchema = z.object({ reason: reasonSchema.optional() })

export const deleteTaskHandler: AccessHandler = async (ctx, access) => {
  const taskId = parseId(ctx.params.id)
  const { reason } = parseQuery(ctx.request, deleteQuerySchema)
  const deleted = await deleteTask(ctx.db, await scopeOf(access), taskId, { reason })
  await access.audit?.({
    action: 'task.delete',
    targetType: 'task',
    targetId: deleted.id,
    reason: reason ?? null,
    summary: { title: deleted.title },
  })
  return noContent()
}

export const taskActivityHandler: AccessHandler = async (ctx, access) => {
  const options = parseQuery(ctx.request, historyQuerySchema)
  return json(await listActivity(ctx.db, reader(access), parseId(ctx.params.id), options))
}

/** One person's own progress; for ANY tasks, "Done" completes the task for the group. */
export const setAssigneeStatusHandler: AccessHandler = async (ctx, access) => {
  const taskId = parseId(ctx.params.id)
  const memberId = parseId(ctx.params.memberId)
  const input = await readJson(ctx.request, setAssigneeStatusSchema)
  const task = await setAssigneeStatus(ctx.db, await scopeOf(access), taskId, memberId, input)
  await access.audit?.({
    action: 'task.progress_override',
    targetType: 'task',
    targetId: task.id,
    reason: input.reason ?? null,
    summary: { title: task.title, memberId, to: input.status, taskStatus: task.status },
  })
  return json({ task })
}

export const reopenTaskHandler: AccessHandler = async (ctx, access) => {
  const taskId = parseId(ctx.params.id)
  const input = await readJson(ctx.request, reopenTaskSchema)
  const task = await reopenTask(ctx.db, await scopeOf(access), taskId, input)
  await access.audit?.({
    action: 'task.reopen',
    targetType: 'task',
    targetId: task.id,
    reason: input.reason ?? null,
    summary: { title: task.title, taskStatus: task.status },
  })
  return json({ task })
}

export const editNoteHandler: AccessHandler = async (ctx, access) => {
  const taskId = parseId(ctx.params.id)
  const input = await readJson(ctx.request, editNoteSchema)
  const task = await editNote(ctx.db, await scopeOf(access), taskId, input)
  await access.audit?.({
    action: 'task.note_edit',
    targetType: 'task',
    targetId: task.id,
    reason: input.reason ?? null,
    summary: { title: task.title, revision: task.progressNoteVersion },
  })
  return json({ task })
}

const clearQuerySchema = z.object({
  expectedNoteVersion: z.coerce.number().int().min(0),
  reason: reasonSchema.optional(),
})

export const clearNoteHandler: AccessHandler = async (ctx, access) => {
  const taskId = parseId(ctx.params.id)
  const input = parseQuery(ctx.request, clearQuerySchema)
  const task = await clearNote(ctx.db, await scopeOf(access), taskId, input)
  await access.audit?.({
    action: 'task.note_clear',
    targetType: 'task',
    targetId: task.id,
    reason: input.reason ?? null,
    summary: { title: task.title, revision: task.progressNoteVersion },
  })
  return json({ task })
}

export const noteRevisionsHandler: AccessHandler = async (ctx, access) => {
  const options = parseQuery(ctx.request, historyQuerySchema)
  return json(await listRevisions(ctx.db, reader(access), parseId(ctx.params.id), options))
}
