import type { TaskDto } from '@shared/types'
import { useState } from 'react'
import { ProgressDialog, type ProgressIntent } from './ProgressDialog'
import { TaskRow } from './TaskRow'

interface TaskListProps {
  tasks: TaskDto[]
  today: string
  label: string
}

/** One bordered list with hairline dividers: rows, not a wall of cards. */
export function TaskList({ tasks, today, label }: TaskListProps) {
  // One dialog for the whole list, opened by whichever row needs it.
  const [open, setOpen] = useState<{ taskId: string; intent: ProgressIntent } | null>(null)
  // Always read the task fresh from the list, so the dialog sees the latest versions.
  const target = open ? tasks.find((task) => task.id === open.taskId) : undefined

  return (
    <>
      <ul
        aria-label={label}
        className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface py-1"
      >
        {tasks.map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            today={today}
            onProgress={(row, intent) => setOpen({ taskId: row.id, intent })}
          />
        ))}
      </ul>
      <ProgressDialog task={target} intent={target ? (open?.intent ?? null) : null} onClose={() => setOpen(null)} />
    </>
  )
}
