import { createContext, useContext } from 'react'
import type { MemberDto, ProjectDto } from '@shared/types'
import { useMembersQuery } from '@/features/team/hooks'
import { useSessionState } from './sessionState'

export const ProjectContext = createContext<ProjectDto | null>(null)

/** The Collabo this browser is inside. Only usable below <ProjectGate>. */
export function useCurrentProject(): ProjectDto {
  const project = useContext(ProjectContext)
  if (!project) throw new Error('useCurrentProject must be used below <ProjectGate>')
  return project
}

export const MemberContext = createContext<MemberDto | null>(null)

/** The acting member, if one is chosen for the current Collabo and still active. */
export function useActingMember(): MemberDto | null {
  const project = useCurrentProject()
  const { selection } = useSessionState()
  const members = useMembersQuery()

  if (selection?.projectId !== project.id) return null
  return members.data?.find((member) => member.id === selection.memberId && member.isActive) ?? null
}

/**
 * The acting member. Only usable below <MemberGate>, which resolves the member
 * once and passes it down, so screens can never observe a half-cleared cache.
 */
export function useCurrentMember(): MemberDto {
  const member = useContext(MemberContext)
  if (!member) throw new Error('useCurrentMember must be used below <MemberGate>')
  return member
}
