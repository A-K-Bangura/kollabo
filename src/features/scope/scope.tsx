import type { MemberDto } from '@shared/types'
import { useMemo, type ReactNode } from 'react'
import { createProjectApi } from '@/lib/api'
import { MEMBER_PREFIX, ScopeContext, type ProjectScope } from './useScope'

interface ProviderProps {
  projectId: string
  children: ReactNode
}

/** Below a valid project session. Without `me` the person is still choosing who they are. */
export function MemberScopeProvider({
  projectId,
  me,
  children,
}: ProviderProps & { me: MemberDto | null }) {
  const value = useMemo<ProjectScope>(
    () => ({
      viewer: 'member',
      projectId,
      api: createProjectApi('/api', me?.id),
      me,
      base: '',
      keyPrefix: MEMBER_PREFIX,
    }),
    [projectId, me],
  )
  return <ScopeContext value={value}>{children}</ScopeContext>
}

/** Below an administrator's session, looking at one Collabo chosen by the URL. */
export function AdminScopeProvider({ projectId, children }: ProviderProps) {
  const value = useMemo<ProjectScope>(
    () => ({
      viewer: 'admin',
      projectId,
      api: createProjectApi(`/api/admin/projects/${projectId}`),
      me: null,
      base: `/admin/projects/${projectId}`,
      keyPrefix: ['admin', 'project', projectId],
    }),
    [projectId],
  )
  return <ScopeContext value={value}>{children}</ScopeContext>
}
