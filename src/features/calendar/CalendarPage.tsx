import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  format,
  getISODay,
  isSameMonth,
  startOfMonth,
  subMonths,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '@/components/layout/PageHeader'
import { RefreshBar } from '@/components/layout/RefreshBar'
import { Button, IconButton } from '@/components/ui/Button'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { useTasksQuery } from '@/features/tasks/hooks'
import { groupByDueDate, isOverdue } from '@/features/tasks/lib'
import { TaskList } from '@/features/tasks/TaskList'
import { useTaskSheet } from '@/features/tasks/useTaskSheet'
import { cn } from '@/lib/cn'
import { parseDateKey, toDateKey, todayKey } from '@/lib/dates'
import { useNow } from '@/lib/useNow'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** A month of due dates. It shows tasks by day; it is not a scheduling tool. */
export function CalendarPage() {
  const tasks = useTasksQuery()
  const { openNew } = useTaskSheet()
  const now = useNow(60_000)
  const today = todayKey(new Date(now))

  const [month, setMonth] = useState(() => startOfMonth(new Date()))
  const [selected, setSelected] = useState(today)

  const byDate = useMemo(() => groupByDueDate(tasks.data ?? []), [tasks.data])
  const days = useMemo(() => eachDayOfInterval({ start: month, end: endOfMonth(month) }), [month])
  const leadingBlanks = getISODay(month) - 1
  const selectedTasks = byDate.get(selected) ?? []

  const goToMonth = (target: Date) => {
    const first = startOfMonth(target)
    setMonth(first)
    // Land on today when it is in view, otherwise on the first of the month.
    setSelected(isSameMonth(first, new Date()) ? todayKey() : toDateKey(first))
  }

  return (
    <>
      <PageHeader title="Calendar" subtitle="Tasks by due date">
        <RefreshBar />
      </PageHeader>

      <div className="rounded-2xl border border-line bg-surface p-3 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 aria-live="polite" className="pl-2 text-lg font-semibold">
            {format(month, 'MMMM yyyy')}
          </h2>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" onClick={() => goToMonth(new Date())}>
              Today
            </Button>
            <IconButton label="Previous month" onClick={() => goToMonth(subMonths(month, 1))}>
              <ChevronLeft className="size-5" aria-hidden />
            </IconButton>
            <IconButton label="Next month" onClick={() => goToMonth(addMonths(month, 1))}>
              <ChevronRight className="size-5" aria-hidden />
            </IconButton>
          </div>
        </div>

        {tasks.isPending ? (
          <div role="status" aria-label="Loading calendar">
            <Skeleton className="h-72" />
          </div>
        ) : (
          <div role="group" aria-label={`Days in ${format(month, 'MMMM yyyy')}`}>
            <div aria-hidden className="mb-1 grid grid-cols-7 text-center text-xs font-medium text-muted">
              {WEEKDAYS.map((day) => (
                <span key={day} className="py-1">
                  {day}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: leadingBlanks }, (_, index) => (
                <span key={`blank-${index}`} aria-hidden />
              ))}
              {days.map((day) => {
                const key = toDateKey(day)
                const dayTasks = byDate.get(key) ?? []
                const hasOpen = dayTasks.some((task) => task.status !== 'completed')
                const late = dayTasks.some((task) => isOverdue(task, today))
                const isToday = key === today
                const isSelected = key === selected

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelected(key)}
                    aria-pressed={isSelected}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={`${format(day, 'EEEE, MMMM d')}${
                      dayTasks.length > 0
                        ? `, ${dayTasks.length} ${dayTasks.length === 1 ? 'task' : 'tasks'}`
                        : ''
                    }`}
                    className={cn(
                      'flex h-14 flex-col items-center gap-1 rounded-xl pt-1.5 text-sm transition sm:h-[4.5rem] sm:pt-2.5',
                      isSelected ? 'bg-accent-soft ring-2 ring-accent' : 'hover:bg-raised',
                    )}
                  >
                    <span
                      className={cn(
                        'flex size-7 items-center justify-center rounded-full font-medium',
                        isToday && 'bg-accent text-accent-ink',
                      )}
                    >
                      {day.getDate()}
                    </span>
                    <span aria-hidden className="flex h-1.5 gap-0.5">
                      {dayTasks.slice(0, 3).map((task) => (
                        <span
                          key={task.id}
                          className={cn(
                            'size-1.5 rounded-full',
                            late && task.status !== 'completed'
                              ? 'bg-danger'
                              : hasOpen && task.status !== 'completed'
                                ? 'bg-accent'
                                : 'bg-muted/50',
                          )}
                        />
                      ))}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>

      <section aria-labelledby="day-heading" className="mt-7">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 id="day-heading" className="text-base font-semibold">
            {format(parseDateKey(selected), 'EEEE, MMMM d')}
          </h2>
          <Button variant="secondary" size="sm" onClick={() => openNew(selected)}>
            <Plus className="size-4" aria-hidden />
            Add task
          </Button>
        </div>

        {tasks.isError && <ErrorState message={tasks.error.message} onRetry={() => void tasks.refetch()} />}
        {tasks.isSuccess &&
          (selectedTasks.length > 0 ? (
            <TaskList tasks={selectedTasks} today={today} label={`Tasks due ${selected}`} />
          ) : (
            <EmptyState title="No tasks due on this day." className="py-10" />
          ))}
      </section>
    </>
  )
}
