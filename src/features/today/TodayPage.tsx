import { ChevronDown } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router'
import { PageHeader } from '@/components/layout/PageHeader'
import { RefreshBar } from '@/components/layout/RefreshBar'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { EmptyState, ErrorState, TaskListSkeleton } from '@/components/ui/feedback'
import { useTasksQuery } from '@/features/tasks/hooks'
import { groupTodayTasks } from '@/features/tasks/lib'
import { TaskList } from '@/features/tasks/TaskList'
import { cn } from '@/lib/cn'
import { formatLongDate, todayKey } from '@/lib/dates'
import { useNow } from '@/lib/useNow'

function Section({
  title,
  count,
  tone,
  children,
}: {
  title: string
  count: number
  tone?: 'danger'
  children: ReactNode
}) {
  return (
    <section className="mb-7">
      <h2 className="mb-2 flex items-baseline gap-2 text-xs font-semibold uppercase tracking-[0.14em]">
        <span className={cn(tone === 'danger' ? 'text-danger' : 'text-muted')}>{title}</span>
        <span className="text-muted">{count}</span>
      </h2>
      {children}
    </section>
  )
}

/** The quick view: what is late, what is due today, and nothing else. */
export function TodayPage() {
  const tasks = useTasksQuery()
  const now = useNow(60_000)
  const today = todayKey(new Date(now))
  const groups = useMemo(
    () => (tasks.data ? groupTodayTasks(tasks.data, today) : null),
    [tasks.data, today],
  )

  return (
    <>
      <PageHeader title="Today" subtitle={formatLongDate(today)}>
        <RefreshBar />
      </PageHeader>

      {tasks.isPending && <TaskListSkeleton />}

      {tasks.isError && <ErrorState message={tasks.error.message} onRetry={() => void tasks.refetch()} />}

      {groups && (
        <>
          {groups.overdue.length === 0 && groups.dueToday.length === 0 && (
            <EmptyState
              title="Nothing due today."
              description="Looks like a clear day."
              action={
                <Link to="/tasks" className={buttonStyles('secondary')}>
                  See all tasks
                </Link>
              }
            />
          )}

          {groups.overdue.length > 0 && (
            <Section title="Overdue" count={groups.overdue.length} tone="danger">
              <TaskList tasks={groups.overdue} today={today} label="Overdue tasks" />
            </Section>
          )}

          {groups.dueToday.length > 0 && (
            <Section title="Today" count={groups.dueToday.length}>
              <TaskList tasks={groups.dueToday} today={today} label="Tasks due today" />
            </Section>
          )}

          {groups.completedToday.length > 0 && (
            <details className="group">
              <summary className="mb-2 flex w-fit list-none items-center gap-1.5 rounded-lg py-1 text-xs font-semibold uppercase tracking-[0.14em] text-muted [&::-webkit-details-marker]:hidden">
                <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden />
                Completed today · {groups.completedToday.length}
              </summary>
              <TaskList tasks={groups.completedToday} today={today} label="Tasks completed today" />
            </details>
          )}
        </>
      )}
    </>
  )
}
