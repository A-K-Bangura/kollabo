import { STATUS_LABELS } from '@shared/constants'
import type { TaskDto } from '@shared/types'
import type { ReactNode } from 'react'
import { useMemberLookup } from '@/features/team/hooks'
import { cn } from '@/lib/cn'
import { formatDueDate } from '@/lib/dates'
import { useChangeStatus } from './hooks'
import { isOverdue, nextStatus, statusActionLabel } from './lib'
import { StatusIcon } from './StatusIcon'
import { useTaskSheet } from './useTaskSheet'

function TaskMeta({ task, today }: { task: TaskDto; today: string }) {
  const { find } = useMemberLookup()
  const assignee = find(task.assignedToMemberId)
  const completed = task.status === 'completed'

  const parts: ReactNode[] = [
    <span key="who" className="truncate">
      {assignee ? `${assignee.name}${assignee.isActive ? '' : ' (removed)'}` : 'Unassigned'}
    </span>,
  ]
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
}

/**
 * Status button on the left (steps forward: To Do, In Progress, Done, and a
 * finished task reopens), everything else opens the details. Two real buttons,
 * never a clickable div.
 */
export function TaskRow({ task, today }: TaskRowProps) {
  const { openTask } = useTaskSheet()
  const { change, isPending } = useChangeStatus()
  const completed = task.status === 'completed'
  const action = statusActionLabel(task.status)

  return (
    <li className="flex items-start gap-1 px-2 py-1 transition hover:bg-raised/60">
      <button
        type="button"
        onClick={() => change(task, nextStatus(task.status))}
        disabled={isPending}
        aria-label={`${action}: ${task.title}`}
        title={action}
        className="flex size-11 shrink-0 items-center justify-center rounded-full transition active:scale-90 disabled:opacity-50"
      >
        <StatusIcon status={task.status} />
      </button>
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
