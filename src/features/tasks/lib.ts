import type { TaskPriority, TaskStatus } from '@shared/constants'
import { ownProgressBlock, progressCounts } from '@shared/task-progress'
import type { AssigneeDto, MemberDto, TaskDto } from '@shared/types'
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

/** "Mine" only means something to a member; an administrator has no tasks of their own. */
export function filtersFor(hasMember: boolean): typeof FILTERS {
  return hasMember ? FILTERS : FILTERS.filter((filter) => filter.value !== 'mine')
}

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
  memberId: string | null,
): TaskDto[] {
  switch (filter) {
    case 'all':
      return [...tasks]
    case 'mine':
      return memberId ? tasks.filter((task) => isAssigned(task, memberId)) : []
    default:
      return tasks.filter((task) => task.status === filter)
  }
}

export function isAssigned(task: TaskDto, memberId: string | null): boolean {
  return memberId !== null && task.assignees.some((assignee) => assignee.memberId === memberId)
}

export function myRow(task: TaskDto, memberId: string | null): AssigneeDto | undefined {
  return memberId ? task.assignees.find((assignee) => assignee.memberId === memberId) : undefined
}

/** What a person can do with their own progress on a task right now. */
export type ProgressAccess =
  | { kind: 'assignee'; row: AssigneeDto }
  /** Finished for the whole group (ANY): nothing moves until someone reopens it. */
  | { kind: 'group-completed'; row: AssigneeDto }
  | { kind: 'not-assigned' }

export function progressAccess(task: TaskDto, memberId: string | null): ProgressAccess {
  const row = myRow(task, memberId)
  if (!row) return { kind: 'not-assigned' }
  return ownProgressBlock(task.assignmentMode, task.status)
    ? { kind: 'group-completed', row }
    : { kind: 'assignee', row }
}

/**
 * Who a task is for, in few words: "Mariama", "Mariama and Ibrahim", "Mariama, Ibrahim +3".
 * Removed members keep their names so old tasks stay readable.
 */
export function assigneeLabel(
  task: TaskDto,
  find: (id: string | null) => MemberDto | undefined,
): string {
  const names = task.assignees.map((assignee) => find(assignee.memberId)?.name ?? 'Someone')
  if (names.length === 0) return 'Unassigned'
  if (names.length === 1) return names[0]!
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names[0]}, ${names[1]} +${names.length - 2}`
}

/** "2 of 3 done" for a task everyone completes their own part of. Anything else needs no count. */
export function progressLabel(task: TaskDto): string | null {
  if (task.assignmentMode !== 'all' || task.assignees.length < 2) return null
  const { completed, total } = progressCounts(task.assignees)
  return `${completed} of ${total} done`
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

/** The label for the one-tap button on your own part of a task. */
export function statusActionLabel(status: TaskStatus, mode: TaskDto['assignmentMode']): string {
  switch (status) {
    case 'todo':
      return 'Start'
    case 'in_progress':
      return mode === 'any' ? 'Mark done for everyone' : 'Mark my part done'
    case 'completed':
      return 'Reopen my part'
  }
}
