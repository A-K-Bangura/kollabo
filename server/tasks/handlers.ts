import { createTaskSchema, updateTaskSchema } from '../../shared/schemas.js'
import { requireActor, withProject } from '../auth.js'
import { json, noContent, parseId, readJson } from '../http.js'
import {
  createTask,
  deleteTask,
  getTask,
  listActivity,
  listTasks,
  updateTask,
} from './service.js'

/** GET /api/tasks */
export const listTasksHandler = withProject(async ({ db }, session) =>
  json({ tasks: await listTasks(db, session.projectId) }),
)

/** POST /api/tasks */
export const createTaskHandler = withProject(async (ctx, session) => {
  const input = await readJson(ctx.request, createTaskSchema)
  const actorId = await requireActor(ctx, session)
  return json({ task: await createTask(ctx.db, session.projectId, actorId, input) }, { status: 201 })
})

/** GET /api/tasks/:id */
export const getTaskHandler = withProject(async ({ db, params }, session) =>
  json({ task: await getTask(db, session.projectId, parseId(params.id)) }),
)

/** PATCH /api/tasks/:id */
export const updateTaskHandler = withProject(async (ctx, session) => {
  const taskId = parseId(ctx.params.id)
  const input = await readJson(ctx.request, updateTaskSchema)
  const actorId = await requireActor(ctx, session)
  return json({ task: await updateTask(ctx.db, session.projectId, actorId, taskId, input) })
})

/** DELETE /api/tasks/:id */
export const deleteTaskHandler = withProject(async ({ db, params }, session) => {
  await deleteTask(db, session.projectId, parseId(params.id))
  return noContent()
})

/** GET /api/tasks/:id/activity */
export const taskActivityHandler = withProject(async ({ db, params }, session) =>
  json({ activity: await listActivity(db, session.projectId, parseId(params.id)) }),
)
