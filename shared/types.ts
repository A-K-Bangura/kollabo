import type { ActivityAction, TaskPriority, TaskStatus } from './constants.js'

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

export interface TaskDto {
  id: string
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  assignedToMemberId: string | null
  /** Calendar date, YYYY-MM-DD. */
  dueDate: string | null
  createdByMemberId: string
  createdAt: string
  updatedByMemberId: string
  updatedAt: string
  /** Increments on every change. Send it back as `expectedVersion` when editing. */
  version: number
  completedByMemberId: string | null
  completedAt: string | null
}

export interface ActivityDto {
  id: number
  taskId: string
  memberId: string
  action: ActivityAction
  fromStatus: TaskStatus | null
  toStatus: TaskStatus | null
  createdAt: string
}

export interface CreateProjectResponse {
  project: ProjectDto
  members: MemberDto[]
  creatorMemberId: string
  /** The only time the plain access code exists: only its hash is stored. */
  accessCode: string
}
