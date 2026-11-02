import type {
  ActivityAction,
  ActorType,
  AssignmentMode,
  ProjectStatus,
  TaskPriority,
  TaskStatus,
} from './constants.js'

/** JSON shapes returned by the API. Dates are ISO strings; due dates are YYYY-MM-DD. */

export interface ProjectDto {
  id: string
  name: string
  createdAt: string
}

export interface MemberDto {
  id: string
  name: string
  /** Removed members stay in the list (inactive) so history keeps its names. */
  isActive: boolean
  createdAt: string
}

/**
 * Who did something. For a member this is their (unverified) selected name. For a
 * platform admin, project members only ever see "Collabo admin": the real admin
 * identity lives in the admin audit log.
 */
export interface ActorDto {
  type: ActorType
  memberId: string | null
  name: string
}

/** One person's active assignment to a task and their own progress on it. */
export interface AssigneeDto {
  memberId: string
  status: TaskStatus
  assignedAt: string
  startedAt: string | null
  completedAt: string | null
  updatedAt: string
  /** Send as `expectedAssigneeVersion` when changing this person's progress. */
  version: number
}

export interface TaskDto {
  id: string
  title: string
  description: string | null
  /** The overall status, derived from the assignees (see shared/task-progress.ts). */
  status: TaskStatus
  priority: TaskPriority
  /** ALL: each assignee completes their own part. ANY: one assignee can complete it for the group. */
  assignmentMode: AssignmentMode
  /** The active assignees. Empty only for tasks that predate V2 and were never assigned. */
  assignees: AssigneeDto[]
  /** @deprecated V1 single assignee: the first active assignee. Use `assignees`. */
  assignedToMemberId: string | null
  /** Calendar date, YYYY-MM-DD. */
  dueDate: string | null
  createdByMemberId: string | null
  createdBy: ActorDto
  createdAt: string
  updatedByMemberId: string | null
  updatedBy: ActorDto
  updatedAt: string
  /** Increases on every change. Send it back as `expectedVersion` when editing the task. */
  version: number
  completedByMemberId: string | null
  completedBy: ActorDto | null
  completedAt: string | null
  /** The one shared progress note (plain text), or null. */
  progressNote: string | null
  /** 0 until the first note is written. Send as `expectedNoteVersion` when editing the note. */
  progressNoteVersion: number
  noteUpdatedAt: string | null
  noteUpdatedBy: ActorDto | null
}

export interface ActivityDetails {
  /** What caused an overall status change. */
  trigger?:
    | 'group_completion'
    | 'all_completed'
    | 'reopened'
    | 'assignee_added'
    | 'assignee_removed'
    | 'mode_changed'
    | 'override'
  fromMode?: AssignmentMode
  toMode?: AssignmentMode
  /** Note revision number written by this event. */
  revision?: number
  /** For `updated`: which details changed ('title', 'description', 'priority', 'dueDate'), never their text. */
  changed?: string[]
  /** For `updated` when the deadline moved. */
  dueDate?: { from: string | null; to: string | null }
  /** Why a platform admin did it. */
  reason?: string
}

export interface ActivityDto {
  id: number
  taskId: string
  action: ActivityAction
  /** @deprecated The acting member's id (null when an admin acted). Use `actor`. */
  memberId: string | null
  actor: ActorDto
  /** The person the event is about (who was assigned, removed, or progressed). */
  subject: { memberId: string; name: string } | null
  fromStatus: TaskStatus | null
  toStatus: TaskStatus | null
  details: ActivityDetails | null
  createdAt: string
}

export interface NoteRevisionDto {
  id: string
  revisionNumber: number
  /** null for a deliberate "clear". */
  content: string | null
  isClear: boolean
  editor: ActorDto
  createdAt: string
}

export interface CreateProjectResponse {
  project: ProjectDto
  members: MemberDto[]
  creatorMemberId: string
  /** The only time the plain access code exists: only its hash is stored. */
  accessCode: string
}

/* ------------------------------------------------------------------ */
/* Platform administration                                            */
/* ------------------------------------------------------------------ */

export interface AdminProfileDto {
  id: string
  name: string
  email: string
  twoFactorEnabled: boolean
  mustChangePassword: boolean
}

export interface AdminOverviewDto {
  projects: { total: number; active: number; suspended: number; deleted: number }
  members: { active: number }
  tasks: { total: number; todo: number; inProgress: number; completed: number }
  /** Counts over the last 7 days. */
  activity: {
    tasksCreated: number
    tasksCompleted: number
    projectsActive: number
    events: number
  }
  /** Tasks from before V2 that still have nobody assigned. */
  tasksNeedingAssignee: number
}

export interface AdminProjectSummaryDto {
  id: string
  name: string
  status: ProjectStatus
  planKey: string
  billingStatus: string | null
  createdAt: string
  suspendedAt: string | null
  deletedAt: string | null
  /** Latest change to the project or any of its tasks. */
  lastActivityAt: string
  activeMembers: number
  tasks: number
  openTasks: number
}

export interface Paged<T> {
  items: T[]
  page: number
  pageSize: number
  /** Present when cheap to compute (project directory). */
  total?: number
  hasMore: boolean
}

export interface AdminAuditEntryDto {
  id: number
  adminId: string
  adminName: string
  adminEmail: string
  action: string
  targetType: string
  targetId: string | null
  projectId: string | null
  reason: string | null
  summary: Record<string, unknown> | null
  createdAt: string
}

export interface AdminAccountDto {
  id: string
  name: string
  email: string
  status: 'active' | 'deactivated'
  twoFactorEnabled: boolean
  mustChangePassword: boolean
  createdAt: string
}
