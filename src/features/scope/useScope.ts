import type { MemberDto } from '@shared/types'
import { createContext, useContext, useMemo } from 'react'
import type { ProjectApi } from '@/lib/api'

/**
 * Which Collabo the screens below are looking at, and as whom.
 *
 * The task and team screens are written once and used twice: by a project member
 * (their session picks the Collabo, they act as the name they chose) and by a platform
 * administrator (the URL picks the Collabo, they act as themselves). Everything those
 * screens need to know about the difference lives here: the API to call, the cache
 * namespace, and where in-app links should point.
 */
export interface ProjectScope {
  viewer: 'member' | 'admin'
  projectId: string
  api: ProjectApi
  /** The member acting, when the viewer is a member who has chosen who they are. */
  me: MemberDto | null
  /** URL prefix for links inside this scope: '' for members, '/admin/projects/<id>' for admins. */
  base: string
  /** Prepended to every query key so two Collabos (or a member's and an admin's view of one) never share a cache entry. */
  keyPrefix: readonly string[]
}

export const ScopeContext = createContext<ProjectScope | null>(null)

/** A project member's cache namespace (there is only ever one Collabo open per browser). */
export const MEMBER_PREFIX = ['member-scope'] as const

export function useProjectScope(): ProjectScope {
  const scope = useContext(ScopeContext)
  if (!scope) throw new Error('useProjectScope must be used inside a project scope')
  return scope
}

export function useIsAdminViewer(): boolean {
  return useProjectScope().viewer === 'admin'
}

/** Query keys for everything inside a scope. `task(id)` starts with 'task' so one prefix refreshes every open task. */
export function projectKeysFor(keyPrefix: readonly string[]) {
  return {
    members: [...keyPrefix, 'members'] as const,
    tasks: [...keyPrefix, 'tasks'] as const,
    taskPrefix: [...keyPrefix, 'task'] as const,
    task: (id: string) => [...keyPrefix, 'task', id] as const,
    taskActivity: (id: string) => [...keyPrefix, 'task', id, 'activity'] as const,
    taskNotes: (id: string) => [...keyPrefix, 'task', id, 'notes'] as const,
  }
}

export function useProjectKeys() {
  const { keyPrefix } = useProjectScope()
  return useMemo(() => projectKeysFor(keyPrefix), [keyPrefix])
}
