import type { ActorType } from '../shared/constants.js'
import type { Actor, Scope } from './actors.js'
import type { RequestContext } from './http.js'

/** A privileged action to record in the append-only admin audit log. */
export interface AuditEntry {
  action: string
  targetType: string
  targetId?: string | null
  /** Why the admin did it. */
  reason?: string | null
  /** Small before/after description. Never secrets, never raw access codes. */
  summary?: Record<string, unknown> | null
}

/**
 * What a project-scoped handler may do, resolved by the route wrapper, never from
 * request data. The same handlers serve project members (project from their session,
 * actor from the selected name) and platform admins (project from the admin route,
 * actor is the authenticated admin, every change audited in the same transaction).
 */
export interface Access {
  projectId: string
  /** Controls what is revealed: members never see which admin acted. */
  viewer: ActorType
  /** Who is making a change. Members must have chosen who they are first. */
  actor: () => Promise<Actor>
  /** Present only for admins: record a privileged action (inside the request's transaction). */
  audit?: (entry: AuditEntry) => Promise<void>
}

export type AccessHandler = (ctx: RequestContext, access: Access) => Promise<Response>

export async function scopeOf(access: Access): Promise<Scope> {
  return { projectId: access.projectId, actor: await access.actor() }
}
