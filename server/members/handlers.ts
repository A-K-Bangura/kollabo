import {
  createMemberSchema,
  deactivateMemberSchema,
  renameMemberSchema,
} from '../../shared/schemas.js'
import { scopeOf, type AccessHandler } from '../access.js'
import { json, noContent, parseId, readJson } from '../http.js'
import {
  addMembers,
  deactivateMember,
  listMembers,
  reactivateMember,
  renameMember,
} from './service.js'

/** Serve both project members (/api/members/...) and admins (/api/admin/projects/:projectId/members/...). */

export const listMembersHandler: AccessHandler = async (ctx, access) =>
  json({ members: await listMembers(ctx.db, access.projectId) })

/**
 * Adds one person (`name`, typed by hand: a duplicate is an error) or several at once
 * (`names`, pasted from a list: duplicates are skipped and reported). No cap on team size.
 * Adding yourself before choosing who you are is allowed, so no acting member is needed.
 */
export const addMembersHandler: AccessHandler = async (ctx, access) => {
  const input = await readJson(ctx.request, createMemberSchema)
  const single = input.name !== undefined && input.names === undefined
  const result = await addMembers(ctx.db, access.projectId, input.names ?? [input.name!], {
    strict: single,
  })
  await access.audit?.({
    action: 'member.add',
    targetType: 'project',
    targetId: access.projectId,
    summary: { added: result.members.length, skipped: result.skipped.length },
  })
  return json(
    { member: result.members[0] ?? null, members: result.members, skipped: result.skipped },
    { status: 201 },
  )
}

export const renameMemberHandler: AccessHandler = async (ctx, access) => {
  const memberId = parseId(ctx.params.id)
  const { name } = await readJson(ctx.request, renameMemberSchema)
  const member = await renameMember(ctx.db, access.projectId, memberId, name)
  await access.audit?.({
    action: 'member.rename',
    targetType: 'member',
    targetId: member.id,
    summary: { name: member.name },
  })
  return json({ member })
}

export const reactivateMemberHandler: AccessHandler = async (ctx, access) => {
  const member = await reactivateMember(ctx.db, access.projectId, parseId(ctx.params.id))
  await access.audit?.({
    action: 'member.reactivate',
    targetType: 'member',
    targetId: member.id,
    summary: { name: member.name },
  })
  return json({ member })
}

/** V1's `DELETE /api/members/:id`: refuses (409) if the person still has unfinished tasks. */
export const removeMemberHandler: AccessHandler = async (ctx, access) => {
  const memberId = parseId(ctx.params.id)
  await deactivateMember(ctx.db, await scopeOf(access), memberId, {})
  await access.audit?.({ action: 'member.deactivate', targetType: 'member', targetId: memberId })
  return noContent()
}

/** `POST /api/members/:id/deactivate` with a decision about their unfinished tasks. */
export const deactivateMemberHandler: AccessHandler = async (ctx, access) => {
  const memberId = parseId(ctx.params.id)
  const input = await readJson(ctx.request, deactivateMemberSchema)
  await deactivateMember(ctx.db, await scopeOf(access), memberId, input)
  await access.audit?.({
    action: 'member.deactivate',
    targetType: 'member',
    targetId: memberId,
    summary: { reassignedTo: input.reassignToMemberId ?? null },
  })
  return noContent()
}
