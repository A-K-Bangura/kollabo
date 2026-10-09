import { handle } from '../../server/http.js'
import {
  deleteTaskHandler,
  getTaskHandler,
  updateTaskHandler,
} from '../../server/tasks/handlers.js'

export const GET = handle('/api/tasks/:id', getTaskHandler)
export const PATCH = handle('/api/tasks/:id', updateTaskHandler)
export const DELETE = handle('/api/tasks/:id', deleteTaskHandler)
