export const TASK_STATUSES = ['todo', 'in_progress', 'completed'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const
export const ACTIVITY_ACTIONS = ['created', 'updated', 'status_changed'] as const

export const LIMITS = {
  projectName: 60,
  personName: 40,
  taskTitle: 120,
  taskDescription: 2000,
  extraMembersOnCreate: 20,
} as const

/**
 * Header naming the member acting on a request. Used for attribution only:
 * the shared access code is what grants access, not this header.
 */
export const MEMBER_HEADER = 'x-member-id'

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  completed: 'Done',
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}
