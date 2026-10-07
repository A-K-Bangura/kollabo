import { handle } from '../../server/http.js'
import { createTaskHandler, listTasksHandler } from '../../server/tasks/handlers.js'

export const GET = handle('/api/tasks', listTasksHandler)
export const POST = handle('/api/tasks', createTaskHandler)
