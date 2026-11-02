import type { ActorType } from '../shared/constants.js'
import type { ActorDto } from '../shared/types.js'

/**
 * Who is making a change. A member is an (unverified) selected name inside a
 * project; an admin is a genuinely authenticated platform administrator. Services
 * take an Actor so the same code path serves both, and every row records which.
 */
export type Actor =
  | { type: 'member'; memberId: string; name: string }
  | { type: 'admin'; adminId: string; name: string; email: string }

/** What a Collabo's own members see in place of an administrator's personal identity. */
export const PUBLIC_ADMIN_NAME = 'Collabo admin'

/** Everything a service works within: one project, one actor. The project always comes from the verified session or admin route. */
export interface Scope {
  projectId: string
  actor: Actor
}

/** What reading needs: the project, and who is looking (members never see which admin acted). Reading does not require choosing a member. */
export interface ReadScope {
  projectId: string
  viewer: ActorType
}

/** Column pair for "exactly one of member / admin" actor references. */
export function actorRef(actor: Actor): { memberId: string | null; adminId: string | null } {
  return actor.type === 'member'
    ? { memberId: actor.memberId, adminId: null }
    : { memberId: null, adminId: actor.adminId }
}

export function actorType(actor: Actor): ActorType {
  return actor.type
}

/** Names of admins, keyed by id, for admin-facing views. Project-facing views never receive this. */
export type AdminNames = ReadonlyMap<string, string>

export function toActorDto(
  ref: { memberId: string | null; adminId: string | null },
  names: { members: ReadonlyMap<string, string>; admins?: AdminNames },
): ActorDto | null {
  if (ref.adminId) {
    return {
      type: 'admin',
      memberId: null,
      name: names.admins?.get(ref.adminId) ?? PUBLIC_ADMIN_NAME,
    }
  }
  if (ref.memberId) {
    return { type: 'member', memberId: ref.memberId, name: names.members.get(ref.memberId) ?? 'Someone' }
  }
  return null
}
