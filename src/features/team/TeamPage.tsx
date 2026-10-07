import { LogOut } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RefreshBar } from '@/components/layout/RefreshBar'
import { Button } from '@/components/ui/Button'
import { useCurrentProject } from '@/features/session/context'
import { useLeaveCollabo } from '@/features/session/hooks'
import { AccessSection } from './AccessSection'
import { useMemberLookup } from './hooks'
import { MembersSection } from './MembersSection'

export function TeamPage() {
  const project = useCurrentProject()
  const { activeMembers } = useMemberLookup()
  const leave = useLeaveCollabo()

  return (
    <>
      <PageHeader
        title={project.name}
        subtitle={`${activeMembers.length} ${activeMembers.length === 1 ? 'person' : 'people'} in this Collabo`}
      >
        <RefreshBar label="Refresh team" />
      </PageHeader>

      <MembersSection />
      <AccessSection />

      <section aria-label="Leave this Collabo" className="border-t border-line pt-6">
        <p className="mb-3 text-sm text-muted">
          Leaving signs this browser out. Use the code to come back, or enter a different Collabo.
        </p>
        <Button variant="secondary" onClick={() => leave.mutate()} loading={leave.isPending}>
          <LogOut className="size-4" aria-hidden />
          Leave this Collabo
        </Button>
      </section>
    </>
  )
}
