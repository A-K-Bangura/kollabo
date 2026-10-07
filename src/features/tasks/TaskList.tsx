import type { TaskDto } from '@shared/types'
import { TaskRow } from './TaskRow'

interface TaskListProps {
  tasks: TaskDto[]
  today: string
  label: string
}

/** One bordered list with hairline dividers: rows, not a wall of cards. */
export function TaskList({ tasks, today, label }: TaskListProps) {
  return (
    <ul
      aria-label={label}
      className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface py-1"
    >
      {tasks.map((task) => (
        <TaskRow key={task.id} task={task} today={today} />
      ))}
    </ul>
  )
}
