import { addMemberHandler, listMembersHandler } from '../../server/members/handlers.js'
import { handle } from '../../server/http.js'

export const GET = handle('/api/members', listMembersHandler)
export const POST = handle('/api/members', addMemberHandler)
