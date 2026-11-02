import { STATUS_LABELS } from '@shared/constants'
import { nextOwnStatus } from '@shared/task-progress'
import type { TaskDto } from '@shared/types'
import type { ReactNode } from 'react'
import { useProjectScope } from '@/features/scope/scope'
import { useMemberLookup } from '@/features/team/hooks'
import { cn } from '@/lib/cn'
import { formatDueDate } from '@/lib/dates'
import { useOwnProgress } from './hooks'
import { assigneeLabel, isOverdue, progressAccess, progressLabel, statusActionLabel } from './lib'
import type { ProgressIntent } from './ProgressDialog'
import { StatusIcon } from './StatusIcon'
import { useTaskSheet } from './useTaskSheet'

function TaskMeta({ task, today }: { task: TaskDto; today: string }) {
  const { find } = useMemberLookup()
  const completed = task.status === 'completed'
  const counts = progressLabel(task)

  const parts: ReactNode[] = [
    <span key="who" className="truncate">
      {task.assignmentMode === 'any' && task.assignees.length > 1 && (
        <span className="mr-1 rounded bg-raised px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
          Anyone
        </span>
      )}
      {assigneeLabel(task, find)}
    </span>,
  ]
  if (counts && !completed) parts.push(<span key="counts">{counts}</span>)
  if (completed) {
    parts.push(<span key="due">Completed</span>)
  } else if (task.dueDate) {
    parts.push(
      <span key="due" className={cn(isOverdue(task, today) && 'font-medium text-danger')}>
        {formatDueDate(task.dueDate, today)}
      </span>,
    )
  }
  if (task.priority === 'high' && !completed) {
    parts.push(
      <span key="priority" className="text-[11px] font-semibold uppercase tracking-wide text-danger">
        High
      </span>,
    )
  }

  return (
    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm text-muted">
      <span className="sr-only">{STATUS_LABELS[task.status]}.</span>
      {parts.map((part, index) => (
        <span key={index} className="flex items-center gap-x-1.5">
          {index > 0 && <span aria-hidden>·</span>}
          {part}
        </span>
      ))}
    </span>
  )
}

interface TaskRowProps {
  task: TaskDto
  today: string
  /** Ask the list to open the progress dialog (one shared dialog, not one per row). */
  onProgress: (task: TaskDto, intent: ProgressIntent) => void
}

/**
 * On the left, your own part of the task: one tap steps it forward (To Do, In Progress,
 * Done). If you are not assigned, or you are an administrator, it is just a status mark,
 * because only the people assigned change progress. Everything else opens the details.
 * Two real buttons, never a clickable div.
 */
export function TaskRow({ task, today, onProgress }: TaskRowProps) {
  const { openTask } = useTaskSheet()
  const { me } = useProjectScope()
  const { change, isPending } = useOwnProgress()
  const access = progressAccess(task, me?.id ?? null)
  const completed = task.status === 'completed'

  const step = () => {
    if (access.kind !== 'assignee' || !me) return
    const next = nextOwnStatus(access.row.status)
    // Finishing a task anyone can finish ends it for the whole group: say so first.
    if (next === 'completed' && task.assignmentMode === 'any' && task.assignees.length > 1) {
      onProgress(task, { kind: 'status', memberId: me.id, status: next })
      return
    }
    change(task, next)
  }

  return (
    <li className="flex items-start gap-1 px-2 py-1 transition hover:bg-raised/60">
      {access.kind === 'assignee' ? (
        <button
          type="button"
          onClick={step}
          disabled={isPending}
          aria-label={`${statusActionLabel(access.row.status, task.assignmentMode)}: ${task.title}`}
          title={statusActionLabel(access.row.status, task.assignmentMode)}
          className="flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-50"
        >
          <StatusIcon status={access.row.status} />
        </button>
      ) : (
        <span className="flex size-11 shrink-0 items-center justify-center">
          <StatusIcon status={task.status} />
        </span>
      )}
      <button
        type="button"
        onClick={() => openTask(task.id)}
        className="min-w-0 flex-1 rounded-lg py-2 pr-2 text-left"
      >
        <span
          className={cn(
            'line-clamp-2 text-base font-medium leading-snug [overflow-wrap:anywhere]',
            completed && 'text-muted line-through decoration-muted/50',
          )}
        >
          {task.title}
        </span>
        <TaskMeta task={task} today={today} />
      </button>
    </li>
  )
}
