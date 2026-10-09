import { createMemberSchema } from '../../shared/schemas.js'
import { withProject } from '../auth.js'
import { json, noContent, parseId, readJson } from '../http.js'
import { addMember, listMembers, removeMember } from './service.js'

/** GET /api/members */
export const listMembersHandler = withProject(async ({ db }, session) =>
  json({ members: await listMembers(db, session.projectId) }),
)

/** POST /api/members */
export const addMemberHandler = withProject(async ({ request, db }, session) => {
  const { name } = await readJson(request, createMemberSchema)
  return json({ member: await addMember(db, session.projectId, name) }, { status: 201 })
})

/** DELETE /api/members/:id (soft removal) */
export const removeMemberHandler = withProject(async ({ db, params }, session) => {
  await removeMember(db, session.projectId, parseId(params.id))
  return noContent()
})
