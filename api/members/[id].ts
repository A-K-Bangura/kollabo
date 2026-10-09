import { removeMemberHandler } from '../../server/members/handlers.js'
import { handle } from '../../server/http.js'

export const DELETE = handle('/api/members/:id', removeMemberHandler)
