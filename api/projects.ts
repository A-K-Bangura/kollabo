import { handle } from '../server/http.js'
import { createProjectHandler } from '../server/projects/handlers.js'

export const POST = handle('/api/projects', createProjectHandler)
