import { handle } from '../server/http.js'
import { createSessionHandler, deleteSessionHandler } from '../server/projects/handlers.js'

export const POST = handle('/api/session', createSessionHandler)
export const DELETE = handle('/api/session', deleteSessionHandler)
