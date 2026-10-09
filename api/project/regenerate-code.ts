import { handle } from '../../server/http.js'
import { regenerateCodeHandler } from '../../server/projects/handlers.js'

export const POST = handle('/api/project/regenerate-code', regenerateCodeHandler)
