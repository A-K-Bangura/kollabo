import { handle } from '../../server/http.js'
import { getProjectHandler } from '../../server/projects/handlers.js'

export const GET = handle('/api/project', getProjectHandler)
