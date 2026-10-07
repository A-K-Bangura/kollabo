import { Navigate, Outlet } from 'react-router'
import { ErrorState, FullScreenLoading } from '@/components/ui/feedback'
import { useMembersQuery } from '@/features/team/hooks'
import { isSessionError } from '@/lib/api'
import { MemberContext, ProjectContext, useActingMember } from './context'
import { useProjectQuery } from './hooks'

/** Everything below needs a valid project session; without one, back to the landing page. */
export function ProjectGate() {
  const project = useProjectQuery()

  if (project.isPending) return <FullScreenLoading />
  if (project.isError) {
    if (isSessionError(project.error)) return <Navigate to="/" replace />
    return (
      <ErrorState
        className="min-h-dvh justify-center"
        message={project.error.message}
        onRetry={() => void project.refetch()}
      />
    )
  }

  return (
    <ProjectContext value={project.data}>
      <Outlet />
    </ProjectContext>
  )
}

/** The app itself needs to know who is acting; if that is unknown, ask. */
export function MemberGate() {
  const members = useMembersQuery()
  const member = useActingMember()

  if (members.isPending) return <FullScreenLoading />
  if (members.isError) {
    return (
      <ErrorState
        className="min-h-dvh justify-center"
        message={members.error.message}
        onRetry={() => void members.refetch()}
      />
    )
  }
  if (!member) return <Navigate to="/who" replace />

  return (
    <MemberContext value={member}>
      <Outlet />
    </MemberContext>
  )
}
