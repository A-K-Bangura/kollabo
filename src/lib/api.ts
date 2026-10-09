import { MEMBER_HEADER } from '@shared/constants'
import { API_ERROR_MESSAGES, type ApiErrorBody, type ApiErrorCode } from '@shared/errors'
import type { CreateProjectInput, CreateTaskInput, UpdateTaskInput } from '@shared/schemas'
import type {
  ActivityDto,
  CreateProjectResponse,
  MemberDto,
  ProjectDto,
  TaskDto,
} from '@shared/types'

export class ApiClientError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | 'NETWORK'
  readonly details: Record<string, string[]> | undefined

  constructor(
    status: number,
    code: ApiErrorCode | 'NETWORK',
    message: string,
    details?: Record<string, string[]>,
  ) {
    super(message)
    this.name = 'ApiClientError'
    this.status = status
    this.code = code
    this.details = details
  }
}

/** The session is gone (expired, or the access code was regenerated). */
export function isSessionError(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === 'SESSION_INVALID' || error.code === 'UNAUTHENTICATED')
  )
}

export function isConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'TASK_CONFLICT'
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null || !('error' in value)) return false
  const { error } = value as { error: unknown }
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    typeof (error as { message?: unknown }).message === 'string'
  )
}

interface RequestOptions {
  body?: unknown
  /** The member the change is attributed to. */
  actorId?: string
}

async function request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.actorId) headers[MEMBER_HEADER] = options.actorId

  let response: Response
  try {
    response = await fetch(path, {
      method,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: 'same-origin',
      cache: 'no-store',
    })
  } catch {
    throw new ApiClientError(
      0,
      'NETWORK',
      "Can't reach Collabo. Check your connection and try again.",
    )
  }

  if (response.status === 204) return undefined as T

  const data: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    if (isApiErrorBody(data)) {
      const { code, message, details } = data.error
      throw new ApiClientError(response.status, code, message, details)
    }
    throw new ApiClientError(response.status, 'SERVER_ERROR', API_ERROR_MESSAGES.SERVER_ERROR)
  }
  return data as T
}

export const api = {
  createProject: (input: CreateProjectInput) =>
    request<CreateProjectResponse>('POST', '/api/projects', { body: input }),

  enterCode: (code: string) =>
    request<{ project: ProjectDto }>('POST', '/api/session', { body: { code } }).then(
      (result) => result.project,
    ),

  leaveCollabo: () => request<void>('DELETE', '/api/session'),

  getProject: () => request<{ project: ProjectDto }>('GET', '/api/project').then((r) => r.project),

  regenerateCode: () =>
    request<{ accessCode: string }>('POST', '/api/project/regenerate-code').then(
      (result) => result.accessCode,
    ),

  listMembers: () => request<{ members: MemberDto[] }>('GET', '/api/members').then((r) => r.members),

  addMember: (name: string) =>
    request<{ member: MemberDto }>('POST', '/api/members', { body: { name } }).then((r) => r.member),

  removeMember: (id: string) => request<void>('DELETE', `/api/members/${id}`),

  listTasks: () => request<{ tasks: TaskDto[] }>('GET', '/api/tasks').then((r) => r.tasks),

  getTask: (id: string) => request<{ task: TaskDto }>('GET', `/api/tasks/${id}`).then((r) => r.task),

  createTask: (input: CreateTaskInput, actorId: string) =>
    request<{ task: TaskDto }>('POST', '/api/tasks', { body: input, actorId }).then((r) => r.task),

  updateTask: (id: string, input: UpdateTaskInput, actorId: string) =>
    request<{ task: TaskDto }>('PATCH', `/api/tasks/${id}`, { body: input, actorId }).then(
      (r) => r.task,
    ),

  deleteTask: (id: string) => request<void>('DELETE', `/api/tasks/${id}`),

  listActivity: (id: string) =>
    request<{ activity: ActivityDto[] }>('GET', `/api/tasks/${id}/activity`).then((r) => r.activity),
}
