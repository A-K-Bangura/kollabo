import { handle } from '../../../server/http.js'
import { taskActivityHandler } from '../../../server/tasks/handlers.js'

export const GET = handle('/api/tasks/:id/activity', taskActivityHandler)
