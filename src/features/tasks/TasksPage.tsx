import { useMemo } from 'react'
import { useSearchParams } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { RefreshBar } from '@/components/layout/RefreshBar'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorState, TaskListSkeleton } from '@/components/ui/feedback'
import { useCurrentMember } from '@/features/session/context'
import { cn } from '@/lib/cn'
import { todayKey } from '@/lib/dates'
import { useNow } from '@/lib/useNow'
import { useTasksQuery } from './hooks'
import { FILTERS, filterTasks, isTaskFilter, sortTasks, type TaskFilter } from './lib'
import { TaskList } from './TaskList'
import { useTaskSheet } from './useTaskSheet'

const EMPTY_FILTER_COPY: Record<TaskFilter, { title: string; description: string }> = {
  all: { title: 'Nothing here yet.', description: 'Add the first task and get things moving.' },
  mine: { title: 'Nothing assigned to you.', description: 'Tasks assigned to you will show up here.' },
  todo: { title: 'Nothing waiting to start.', description: 'New tasks land here.' },
  in_progress: { title: 'Nothing in progress.', description: 'Start a task and it will show up here.' },
  completed: { title: 'Nothing finished yet.', description: 'Completed tasks will collect here.' },
}

/** The heart of Collabo: one clean list, filtered by who and by status. */
export function TasksPage() {
  const tasks = useTasksQuery()
  const member = useCurrentMember()
  const { openNew } = useTaskSheet()
  const [params, setParams] = useSearchParams()
  const now = useNow(60_000)
  const today = todayKey(new Date(now))

  const requested = params.get('filter')
  const filter: TaskFilter = isTaskFilter(requested) ? requested : 'all'

  const setFilter = (next: TaskFilter) =>
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous)
        if (next === 'all') updated.delete('filter')
        else updated.set('filter', next)
        return updated
      },
      { replace: true },
    )

  const visible = useMemo(
    () => (tasks.data ? sortTasks(filterTasks(tasks.data, filter, member.id)) : []),
    [tasks.data, filter, member.id],
  )

  return (
    <>
      <PageHeader title="Tasks">
        <RefreshBar />
      </PageHeader>

      <div role="group" aria-label="Filter tasks" className="mb-4 flex flex-wrap gap-1.5 sm:gap-2">
        {FILTERS.map(({ value, label }) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'h-10 rounded-full border px-3 text-[13px] font-medium transition sm:px-4 sm:text-sm',
              filter === value
                ? 'border-accent bg-accent text-accent-ink'
                : 'border-line bg-surface text-muted hover:bg-raised hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tasks.isPending && <TaskListSkeleton rows={5} />}

      {tasks.isError && <ErrorState message={tasks.error.message} onRetry={() => void tasks.refetch()} />}

      {tasks.isSuccess &&
        (visible.length > 0 ? (
          <TaskList tasks={visible} today={today} label="Tasks" />
        ) : (
          <EmptyState
            {...EMPTY_FILTER_COPY[tasks.data.length === 0 ? 'all' : filter]}
            action={
              tasks.data.length === 0 ? <Button onClick={() => openNew()}>Add a task</Button> : undefined
            }
          />
        ))}
    </>
  )
}
