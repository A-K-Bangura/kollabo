import type { AdminProjectSummaryDto } from '@shared/types'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, Plus } from 'lucide-react'
import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { RefreshBar } from '@/components/layout/RefreshBar'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { EmptyState, ErrorState, InlineAlert, Skeleton } from '@/components/ui/feedback'
import { AdminScopeProvider } from '@/features/scope/scope'
import { TasksView } from '@/features/tasks/TasksPage'
import { TaskSheet } from '@/features/tasks/TaskSheet'
import { useTaskSheet } from '@/features/tasks/useTaskSheet'
import { MembersSection } from '@/features/team/MembersSection'
import { ApiClientError } from '@/lib/api'
import { adminApi } from '@/lib/adminApi'
import { cn } from '@/lib/cn'
import { AuditEntries } from './AuditEntries'
import { adminKeys } from './hooks'
import { ProjectActions } from './ProjectActions'
import { AdminRefresh, ProjectStatusPill, SectionHeading, Stat, relativeTime } from './ui'

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'tasks', label: 'Tasks' },
  { value: 'members', label: 'Members' },
  { value: 'history', label: 'History' },
] as const

type Tab = (typeof TABS)[number]['value']

function Facts({ project }: { project: AdminProjectSummaryDto }) {
  const rows: [string, string][] = [
    ['Created', format(parseISO(project.createdAt), 'MMM d, yyyy')],
    ['Last activity', relativeTime(project.lastActivityAt)],
    ['Plan', project.planKey + (project.billingStatus ? ` · ${project.billingStatus}` : '')],
  ]
  if (project.suspendedAt) rows.push(['Suspended', format(parseISO(project.suspendedAt), 'MMM d, yyyy h:mm a')])
  if (project.deletedAt) rows.push(['Deleted', format(parseISO(project.deletedAt), 'MMM d, yyyy h:mm a')])
  return (
    <dl className="divide-y divide-line rounded-2xl border border-line bg-surface px-4">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-center justify-between gap-4 py-3">
          <dt className="text-sm text-muted">{label}</dt>
          <dd className="text-right text-[15px] font-medium">{value}</dd>
        </div>
      ))}
      <div className="flex items-center justify-between gap-4 py-3">
        <dt className="text-sm text-muted">Project id</dt>
        <dd className="min-w-0 select-all break-all text-right font-mono text-xs">{project.id}</dd>
      </div>
    </dl>
  )
}

function HistoryTab({ projectId }: { projectId: string }) {
  const [page, setPage] = useState(1)
  const audit = useQuery({
    queryKey: [...adminKeys.audit, projectId, page],
    queryFn: () => adminApi.auditLog({ projectId, page, limit: 25 }),
    placeholderData: keepPreviousData,
  })

  if (audit.isPending) return <Skeleton className="h-40" />
  if (audit.isError) return <ErrorState message={audit.error.message} onRetry={() => void audit.refetch()} />
  if (audit.data.items.length === 0) {
    return (
      <EmptyState
        title="No admin activity yet."
        description="Anything an administrator does in this project, or to it, will be listed here."
      />
    )
  }
  return (
    <>
      <AuditEntries entries={audit.data.items} />
      <div className="mt-4 flex items-center justify-between">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
          Newer
        </Button>
        <p className="text-sm text-muted">Page {page}</p>
        <Button variant="secondary" size="sm" disabled={!audit.data.hasMore} onClick={() => setPage((p) => p + 1)}>
          Older
        </Button>
      </div>
    </>
  )
}

function ProjectView({ project, tab }: { project: AdminProjectSummaryDto; tab: Tab }) {
  const { openNew } = useTaskSheet()
  const deleted = project.status === 'deleted'

  return (
    <>
      {deleted && (
        <div className="mb-5">
          <InlineAlert tone="warn">
            This project is deleted: its members can’t open it. You can look around, but recover it before changing anything.
          </InlineAlert>
        </div>
      )}
      {project.status === 'suspended' && (
        <div className="mb-5">
          <InlineAlert tone="warn">
            This project is suspended: its members see a notice instead of their tasks. You can still work in it.
          </InlineAlert>
        </div>
      )}

      {tab === 'overview' && (
        <div className="flex flex-col gap-8">
          <section aria-labelledby="size-heading">
            <SectionHeading id="size-heading">At a glance</SectionHeading>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="People" value={project.activeMembers} />
              <Stat label="Tasks" value={project.tasks} />
              <Stat label="Open" value={project.openTasks} />
            </div>
          </section>
          <section aria-labelledby="facts-heading">
            <SectionHeading id="facts-heading">Details</SectionHeading>
            <Facts project={project} />
          </section>
          <ProjectActions project={project} />
        </div>
      )}

      {tab === 'tasks' && (
        <>
          <div className="mb-4 flex flex-col gap-3">
            <RefreshBar />
            {!deleted && (
              <Button className="self-start" onClick={() => openNew()}>
                <Plus className="size-4" aria-hidden />
                New task
              </Button>
            )}
          </div>
          <TasksView />
        </>
      )}

      {tab === 'members' && (
        <>
          <div className="mb-4">
            <RefreshBar label="Refresh team" />
          </div>
          {deleted ? (
            <p className="mb-4 text-[15px] text-muted">Recover the project to change its team.</p>
          ) : null}
          <MembersSection />
        </>
      )}

      {tab === 'history' && <HistoryTab projectId={project.id} />}

      <TaskSheet />
    </>
  )
}

/** One project, inside out: its numbers and lifecycle, and its real tasks and team through the same screens members use. */
export function AdminProjectPage() {
  const { projectId = '' } = useParams()
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab: Tab = TABS.some((t) => t.value === requested) ? (requested as Tab) : 'overview'
  const [refreshing, setRefreshing] = useState(false)

  const project = useQuery({
    queryKey: adminKeys.project(projectId),
    queryFn: () => adminApi.getProject(projectId),
    retry: false,
  })

  const refresh = async () => {
    setRefreshing(true)
    try {
      await project.refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const selectTab = (next: Tab) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous)
        for (const key of ['task', 'new', 'due']) updated.delete(key)
        if (next === 'overview') updated.delete('tab')
        else updated.set('tab', next)
        return updated
      },
      { replace: true },
    )

  if (project.isPending) {
    return (
      <div role="status" aria-label="Loading project" className="space-y-3">
        <Skeleton className="h-9 w-1/2" />
        <Skeleton className="h-40" />
      </div>
    )
  }
  if (project.isError) {
    if (project.error instanceof ApiClientError && project.error.code === 'PROJECT_NOT_FOUND') {
      return (
        <EmptyState
          title="That project doesn’t exist."
          action={
            <Link to="/admin/projects" className={buttonStyles('secondary')}>
              Back to projects
            </Link>
          }
        />
      )
    }
    return <ErrorState message={project.error.message} onRetry={() => void project.refetch()} />
  }

  const data = project.data
  return (
    <AdminScopeProvider projectId={projectId}>
      <Link
        to="/admin/projects"
        className="-ml-2 mb-3 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[15px] text-muted hover:bg-raised hover:text-ink"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Projects
      </Link>

      <header className="mb-5 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 text-[1.75rem] font-semibold leading-tight tracking-tight [overflow-wrap:anywhere]">
            {data.name}
          </h1>
          <ProjectStatusPill status={data.status} />
        </div>
        <AdminRefresh updatedAt={project.dataUpdatedAt} onRefresh={refresh} refreshing={refreshing} label="Refresh summary" />
      </header>

      <nav aria-label="Project sections" className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-raised p-1">
        {TABS.map((item) => (
          <button
            key={item.value}
            type="button"
            aria-current={tab === item.value ? 'page' : undefined}
            onClick={() => selectTab(item.value)}
            className={cn(
              'h-10 flex-1 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition',
              tab === item.value ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <ProjectView project={data} tab={tab} />
    </AdminScopeProvider>
  )
}
