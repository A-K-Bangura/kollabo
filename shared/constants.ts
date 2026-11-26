export const TASK_STATUSES = ['todo', 'in_progress', 'completed'] as const
export const TASK_PRIORITIES = ['low', 'medium', 'high'] as const
export const ASSIGNMENT_MODES = ['all', 'any'] as const
export const PROJECT_STATUSES = ['active', 'suspended', 'deleted'] as const
export const ACTOR_TYPES = ['member', 'admin'] as const
/**
 * New values are only ever appended: Postgres enums cannot reorder or drop
 * values safely, and old rows keep their meaning.
 */
export const ACTIVITY_ACTIONS = [
  'created',
  'updated',
  'status_changed',
  'assignee_added',
  'assignee_removed',
  'assignee_status_changed',
  'mode_changed',
  'note_edited',
  'note_cleared',
] as const

export const LIMITS = {
  projectName: 60,
  personName: 40,
  taskTitle: 120,
  taskDescription: 2000,
  progressNote: 4000,
  /** Free-text justification attached to privileged admin actions. */
  reason: 500,
  /**
   * How many names one request may add. This only bounds a single request; it is
   * not a cap on how many members a Collabo can have.
   */
  membersPerRequest: 200,
  pageSize: 50,
} as const

/**
 * Header naming the member acting on a request. Used for attribution only:
 * the shared access code is what grants access, not this header.
 */
export const MEMBER_HEADER = 'x-member-id'

export type TaskStatus = (typeof TASK_STATUSES)[number]
export type AssignmentMode = (typeof ASSIGNMENT_MODES)[number]
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export type ActorType = (typeof ACTOR_TYPES)[number]
export type TaskPriority = (typeof TASK_PRIORITIES)[number]
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]

export const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  completed: 'Done',
}

export const MODE_LABELS: Record<AssignmentMode, string> = {
  all: 'Everyone',
  any: 'Anyone',
}

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}
