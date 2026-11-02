import { and, eq } from 'drizzle-orm'
import { MEMBER_HEADER } from '../shared/constants.js'
import { uuidSchema } from '../shared/schemas.js'
import type { Access } from './access.js'
import type { Actor } from './actors.js'
import { members, projects } from './db/schema.js'
import { ApiError } from './errors.js'
import type { Handler, RequestContext } from './http.js'
import { readSessionCookie, verifySessionToken } from './security/session.js'

export interface ProjectSession {
  /** Always derived from the verified session, never from client input. */
  projectId: string
  projectName: string
  projectCreatedAt: Date
  sessionVersion: number
}

/**
 * Resolves the project this request is allowed to touch. The signed cookie names
 * one project and a session version; if the project's version has moved on
 * (code regenerated) the cookie is dead. A suspended project refuses everything
 * (423) until an administrator reactivates it, and a deleted one no longer exists
 * as far as project sessions are concerned.
 */
export async function requireProject(ctx: RequestContext): Promise<ProjectSession> {
  const token = readSessionCookie(ctx.request)
  if (!token) throw new ApiError('UNAUTHENTICATED')

  const claims = verifySessionToken(token)
  if (!claims) throw new ApiError('SESSION_INVALID')

  const project = await ctx.db.query.projects.findFirst({
    where: eq(projects.id, claims.projectId),
    columns: { id: true, name: true, createdAt: true, sessionVersion: true, status: true },
  })
  if (!project || project.sessionVersion !== claims.version || project.status === 'deleted') {
    throw new ApiError('SESSION_INVALID')
  }
  if (project.status === 'suspended') throw new ApiError('PROJECT_SUSPENDED')

  return {
    projectId: project.id,
    projectName: project.name,
    projectCreatedAt: project.createdAt,
    sessionVersion: project.sessionVersion,
  }
}

/** Wraps a handler so it only runs for a valid session, passing the project scope in. */
export function withProject(
  handler: (ctx: RequestContext, session: ProjectSession) => Promise<Response>,
): Handler {
  return async (ctx) => handler(ctx, await requireProject(ctx))
}

/**
 * The member a change is attributed to. This is identity for attribution, not
 * authentication: it only has to be an active member of the session's project.
 */
export async function requireActor(ctx: RequestContext, session: ProjectSession): Promise<Actor> {
  const parsed = uuidSchema.safeParse(ctx.request.headers.get(MEMBER_HEADER))
  if (!parsed.success) throw new ApiError('MEMBER_REQUIRED')

  const member = await ctx.db.query.members.findFirst({
    where: and(
      eq(members.id, parsed.data),
      eq(members.projectId, session.projectId),
      eq(members.isActive, true),
    ),
    columns: { id: true, name: true },
  })
  if (!member) throw new ApiError('MEMBER_REQUIRED')
  return { type: 'member', memberId: member.id, name: member.name }
}

/** The access a project member's session grants: their project, and (for writes) the member they selected. */
export function memberAccess(ctx: RequestContext, session: ProjectSession): Access {
  let resolved: Promise<Actor> | undefined
  return {
    projectId: session.projectId,
    viewer: 'member',
    actor: () => (resolved ??= requireActor(ctx, session)),
  }
}
