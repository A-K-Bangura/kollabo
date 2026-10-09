import type { TaskPriority, TaskStatus } from '@shared/constants'
import type { TaskDto } from '@shared/types'
import { parseISO } from 'date-fns'
import { toDateKey } from '@/lib/dates'

export type TaskFilter = 'all' | 'mine' | TaskStatus

export const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'mine', label: 'Mine' },
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Done' },
]

export function isTaskFilter(value: string | null): value is TaskFilter {
  return FILTERS.some((filter) => filter.value === value)
}

const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }

/**
 * Open work first (soonest due date first, undated last, then by priority),
 * finished work after it (most recently completed first).
 */
export function compareTasks(a: TaskDto, b: TaskDto): number {
  const aDone = a.status === 'completed'
  const bDone = b.status === 'completed'
  if (aDone !== bDone) return aDone ? 1 : -1
  if (aDone) return (b.completedAt ?? '').localeCompare(a.completedAt ?? '')

  if (a.dueDate !== b.dueDate) {
    if (a.dueDate === null) return 1
    if (b.dueDate === null) return -1
    return a.dueDate < b.dueDate ? -1 : 1
  }

  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]
  if (byPriority !== 0) return byPriority
  return b.createdAt.localeCompare(a.createdAt)
}

export function sortTasks(tasks: readonly TaskDto[]): TaskDto[] {
  return [...tasks].sort(compareTasks)
}

export function filterTasks(
  tasks: readonly TaskDto[],
  filter: TaskFilter,
  memberId: string,
): TaskDto[] {
  switch (filter) {
    case 'all':
      return [...tasks]
    case 'mine':
      return tasks.filter((task) => task.assignedToMemberId === memberId)
    default:
      return tasks.filter((task) => task.status === filter)
  }
}

export function isOverdue(task: TaskDto, today: string): boolean {
  return task.status !== 'completed' && task.dueDate !== null && task.dueDate < today
}

export interface TodayGroups {
  overdue: TaskDto[]
  dueToday: TaskDto[]
  completedToday: TaskDto[]
}

/** What the Today screen shows. Future work is deliberately left out. */
export function groupTodayTasks(tasks: readonly TaskDto[], today: string): TodayGroups {
  const open = tasks.filter((task) => task.status !== 'completed')
  return {
    overdue: sortTasks(open.filter((task) => isOverdue(task, today))),
    dueToday: sortTasks(open.filter((task) => task.dueDate === today)),
    completedToday: sortTasks(
      tasks.filter(
        (task) =>
          task.status === 'completed' &&
          task.completedAt !== null &&
          toDateKey(parseISO(task.completedAt)) === today,
      ),
    ),
  }
}

/** Tasks grouped by due date key, for the calendar. Undated tasks are skipped. */
export function groupByDueDate(tasks: readonly TaskDto[]): Map<string, TaskDto[]> {
  const groups = new Map<string, TaskDto[]>()
  for (const task of tasks) {
    if (task.dueDate === null) continue
    const group = groups.get(task.dueDate)
    if (group) group.push(task)
    else groups.set(task.dueDate, [task])
  }
  for (const [key, group] of groups) groups.set(key, sortTasks(group))
  return groups
}

/** To Do -> In Progress -> Done, and a finished task reopens to To Do. */
export function nextStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case 'todo':
      return 'in_progress'
    case 'in_progress':
      return 'completed'
    case 'completed':
      return 'todo'
  }
}

export function statusActionLabel(status: TaskStatus): string {
  switch (status) {
    case 'todo':
      return 'Start'
    case 'in_progress':
      return 'Mark done'
    case 'completed':
      return 'Reopen'
  }
}
