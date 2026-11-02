import { PROJECT_STATUSES } from '@shared/constants'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Search } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { adminApi } from '@/lib/adminApi'
import { cn } from '@/lib/cn'
import { adminKeys } from './hooks'
import { AdminRefresh, ProjectStatusPill, relativeTime } from './ui'

const STATUS_FILTERS = [{ value: 'all', label: 'All' }, ...PROJECT_STATUSES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))]

const SORTS = [
  { value: 'activity', label: 'Latest activity' },
  { value: 'created', label: 'Newest' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'size', label: 'Most people' },
]

const PAGE_SIZE = 25

/**
 * Every project on the platform. Search matches the project name, any member's name, or the
 * start of a project id; the filters, sort and page all live in the URL so a view can be
 * bookmarked or shared with another administrator.
 */
export function ProjectDirectoryPage() {
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const status = STATUS_FILTERS.some((f) => f.value === params.get('status')) ? params.get('status')! : 'all'
  const sort = SORTS.some((s) => s.value === params.get('sort')) ? params.get('sort')! : 'activity'
  const page = Math.max(1, Number(params.get('page')) || 1)
  const [draft, setDraft] = useState(search)
  const [refreshing, setRefreshing] = useState(false)

  const query = { search, status, sort, page, limit: PAGE_SIZE }
  const projects = useQuery({
    queryKey: [...adminKeys.projects, query],
    queryFn: () => adminApi.listProjects(query),
    // Keep the old page on screen while the next loads, so paging doesn't flash empty.
    placeholderData: keepPreviousData,
  })

  const update = (changes: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '' || value === 'all' || (key === 'sort' && value === 'activity')) next.delete(key)
          else next.set(key, value)
        }
        if (!('page' in changes)) next.delete('page')
        return next
      },
      { replace: true },
    )

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    update({ q: draft.trim() })
  }

  const refresh = async () => {
    setRefreshing(true)
    try {
      await projects.refetch()
    } finally {
      setRefreshing(false)
    }
  }

  const data = projects.data
  const pages = data?.total ? Math.ceil(data.total / PAGE_SIZE) : 1

  return (
    <>
      <PageHeader title="Projects" subtitle={data ? `${data.total ?? data.items.length} ${data.total === 1 ? 'project' : 'projects'}` : undefined}>
        <AdminRefresh updatedAt={projects.dataUpdatedAt} onRefresh={refresh} refreshing={refreshing || projects.isFetching} />
      </PageHeader>

      <form onSubmit={submitSearch} role="search" className="mb-3 flex gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Search projects"
            placeholder="Project name, member name or id"
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base transition hover:border-muted/50"
          />
        </div>
        <Button type="submit">Search</Button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              aria-pressed={status === filter.value}
              onClick={() => update({ status: filter.value })}
              className={cn(
                'h-10 rounded-full border px-4 text-sm font-medium transition',
                status === filter.value
                  ? 'border-accent bg-accent text-accent-ink'
                  : 'border-line bg-surface text-muted hover:bg-raised hover:text-ink',
              )}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <label className="ml-auto flex items-center gap-2 text-sm text-muted">
          Sort
          <select
            value={sort}
            onChange={(event) => update({ sort: event.target.value })}
            className="h-10 rounded-xl border border-line bg-surface px-3 text-sm text-ink"
          >
            {SORTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {projects.isPending && (
        <div role="status" aria-label="Loading projects" className="space-y-2">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} className="h-[4.5rem]" />
          ))}
        </div>
      )}
      {projects.isError && <ErrorState message={projects.error.message} onRetry={() => void projects.refetch()} />}

      {data && data.items.length === 0 && (
        <EmptyState
          title="No projects match."
          description={search ? 'Try a different name, or clear the filters.' : 'Nothing here yet.'}
          action={
            search || status !== 'all' ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setDraft('')
                  setParams({}, { replace: true })
                }}
              >
                Clear filters
              </Button>
            ) : undefined
          }
        />
      )}

      {data && data.items.length > 0 && (
        <ul aria-label="Projects" className={cn('divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface', projects.isPlaceholderData && 'opacity-60')}>
          {data.items.map((project) => (
            <li key={project.id}>
              <Link
                to={`/admin/projects/${project.id}`}
                className="flex flex-col gap-1 px-4 py-3 transition hover:bg-raised/60 sm:flex-row sm:items-center sm:gap-4"
              >
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <span className="truncate text-base font-medium">{project.name}</span>
                  <ProjectStatusPill status={project.status} />
                </span>
                <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-muted">
                  <span>
                    {project.activeMembers} {project.activeMembers === 1 ? 'person' : 'people'}
                  </span>
                  <span>
                    {project.openTasks} open / {project.tasks} {project.tasks === 1 ? 'task' : 'tasks'}
                  </span>
                  <span>Active {relativeTime(project.lastActivityAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {data && pages > 1 && (
        <nav aria-label="Pages" className="mt-4 flex items-center justify-between gap-3">
          <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) })}>
            <ChevronLeft className="size-4" aria-hidden />
            Previous
          </Button>
          <p className="text-sm text-muted">
            Page {page} of {pages}
          </p>
          <Button variant="secondary" size="sm" disabled={!data.hasMore} onClick={() => update({ page: String(page + 1) })}>
            Next
            <ChevronRight className="size-4" aria-hidden />
          </Button>
        </nav>
      )}
    </>
  )
}
