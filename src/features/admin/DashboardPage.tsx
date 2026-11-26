import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { ErrorState, Skeleton } from '@/components/ui/feedback'
import { adminApi } from '@/lib/adminApi'
import { adminKeys, useAdminQuery } from './hooks'
import { AdminRefresh, SectionHeading, Stat } from './ui'

export function DashboardPage() {
  const me = useAdminQuery()
  const overview = useQuery({ queryKey: adminKeys.overview, queryFn: adminApi.overview })
  const [refreshing, setRefreshing] = useState(false)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await overview.refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const data = overview.data
  const open = data ? data.tasks.todo + data.tasks.inProgress : 0

  return (
    <>
      <PageHeader title="Overview" subtitle={me.data ? `Signed in as ${me.data.name}` : undefined}>
        <AdminRefresh updatedAt={overview.dataUpdatedAt} onRefresh={refresh} refreshing={refreshing} />
      </PageHeader>

      {overview.isPending && (
        <div role="status" aria-label="Loading overview" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <Skeleton key={index} className="h-24" />
          ))}
        </div>
      )}
      {overview.isError && <ErrorState message={overview.error.message} onRetry={() => void overview.refetch()} />}

      {data && (
        <div className="flex flex-col gap-8">
          {(data.projects.suspended > 0 || data.tasksNeedingAssignee > 0) && (
            <section aria-labelledby="attention-heading">
              <SectionHeading id="attention-heading">Needs attention</SectionHeading>
              <div className="grid gap-3 sm:grid-cols-2">
                {data.projects.suspended > 0 && (
                  <Stat
                    label="Suspended projects"
                    value={data.projects.suspended}
                    hint="Members can’t open these right now."
                    tone="warn"
                    to="/admin/projects?status=suspended"
                  />
                )}
                {data.tasksNeedingAssignee > 0 && (
                  <Stat
                    label="Open tasks with nobody assigned"
                    value={data.tasksNeedingAssignee}
                    hint="Left over from before tasks could be shared. Assign people from the project page."
                    tone="warn"
                  />
                )}
              </div>
            </section>
          )}

          <section aria-labelledby="projects-heading">
            <SectionHeading id="projects-heading">Projects</SectionHeading>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Total" value={data.projects.total} to="/admin/projects" />
              <Stat label="Active" value={data.projects.active} to="/admin/projects?status=active" />
              <Stat label="Suspended" value={data.projects.suspended} to="/admin/projects?status=suspended" />
              <Stat label="Deleted" value={data.projects.deleted} to="/admin/projects?status=deleted" />
            </div>
          </section>

          <section aria-labelledby="work-heading">
            <SectionHeading id="work-heading">People and work</SectionHeading>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="People" value={data.members.active} hint="Active members" />
              <Stat label="Tasks" value={data.tasks.total} />
              <Stat label="Open" value={open} hint={`${data.tasks.todo} to do · ${data.tasks.inProgress} in progress`} />
              <Stat label="Done" value={data.tasks.completed} />
            </div>
          </section>

          <section aria-labelledby="week-heading">
            <SectionHeading id="week-heading">Last 7 days</SectionHeading>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Stat label="Tasks created" value={data.activity.tasksCreated} />
              <Stat label="Tasks completed" value={data.activity.tasksCompleted} />
              <Stat label="Projects with activity" value={data.activity.projectsActive} />
              <Stat label="Task events" value={data.activity.events} />
            </div>
          </section>

          <div>
            <Link to="/admin/projects" className={buttonStyles('secondary')}>
              Browse all projects
            </Link>
          </div>
        </div>
      )}
    </>
  )
}
