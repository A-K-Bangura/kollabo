import { MEMBER_HEADER } from '@shared/constants'
import { API_ERROR_MESSAGES, type ApiErrorBody, type ApiErrorCode } from '@shared/errors'
import type {
  CreateProjectInput,
  CreateTaskInput,
  EditNoteInput,
  ReopenTaskInput,
  SetAssigneeStatusInput,
  UpdateTaskInput,
} from '@shared/schemas'
import type {
  ActivityDto,
  CreateProjectResponse,
  MemberDto,
  NoteRevisionDto,
  ProjectDto,
  TaskDto,
} from '@shared/types'

export class ApiClientError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | 'NETWORK'
  readonly details: Record<string, unknown> | undefined

  constructor(
    status: number,
    code: ApiErrorCode | 'NETWORK',
    message: string,
    details?: Record<string, unknown>,
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

/** A platform administrator has suspended this Collabo. */
export function isSuspendedError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'PROJECT_SUSPENDED'
}

/** An administrator's own sign-in is missing, expired or not yet complete. */
export function isAdminSessionError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'ADMIN_REQUIRED'
}

/** Someone else changed what you were editing since you last refreshed. */
export function isConflict(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.code === 'TASK_CONFLICT' ||
      error.code === 'ASSIGNEE_CONFLICT' ||
      error.code === 'NOTE_CONFLICT')
  )
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

export interface RequestOptions {
  body?: unknown
  /** The member the change is attributed to. */
  actorId?: string | undefined
  query?: Record<string, string | number | undefined>
}

export async function request<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' }
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.actorId) headers[MEMBER_HEADER] = options.actorId

  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const url = search.size > 0 ? `${path}?${search}` : path

  let response: Response
  try {
    response = await fetch(url, {
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

export interface AddMembersResult {
  member: MemberDto | null
  members: MemberDto[]
  /** Names that were not added because someone with that name is already in the Collabo. */
  skipped: string[]
}

export interface DeactivateInput {
  /** undefined: refuse if they have unfinished work. A member id: that member takes it over. null: just remove them. */
  reassignToMemberId?: string | null
}

/**
 * Everything inside one Collabo: members and tasks. The same calls serve a project member
 * (`/api/...`, attributed to the member they chose) and a platform administrator
 * (`/api/admin/projects/:id/...`, attributed to their own signed-in identity), so the
 * screens built on top do not care which of the two is looking.
 */
export function createProjectApi(base: string, actorId?: string) {
  const act = { actorId }
  return {
    listMembers: () =>
      request<{ members: MemberDto[] }>('GET', `${base}/members`).then((r) => r.members),

    addMembers: (names: string[]) =>
      request<AddMembersResult>('POST', `${base}/members`, {
        body: names.length === 1 ? { name: names[0] } : { names },
        ...act,
      }),

    renameMember: (id: string, name: string) =>
      request<{ member: MemberDto }>('PATCH', `${base}/members/${id}`, { body: { name }, ...act }).then(
        (r) => r.member,
      ),

    deactivateMember: (id: string, input: DeactivateInput) =>
      request<void>('POST', `${base}/members/${id}/deactivate`, { body: input, ...act }),

    reactivateMember: (id: string) =>
      request<{ member: MemberDto }>('POST', `${base}/members/${id}/reactivate`, {
        body: {},
        ...act,
      }).then((r) => r.member),

    listTasks: () => request<{ tasks: TaskDto[] }>('GET', `${base}/tasks`).then((r) => r.tasks),

    getTask: (id: string) =>
      request<{ task: TaskDto }>('GET', `${base}/tasks/${id}`).then((r) => r.task),

    createTask: (input: CreateTaskInput) =>
      request<{ task: TaskDto }>('POST', `${base}/tasks`, { body: input, ...act }).then((r) => r.task),

    updateTask: (id: string, input: UpdateTaskInput) =>
      request<{ task: TaskDto }>('PATCH', `${base}/tasks/${id}`, { body: input, ...act }).then(
        (r) => r.task,
      ),

    deleteTask: (id: string, reason?: string) =>
      request<void>('DELETE', `${base}/tasks/${id}`, { query: { reason }, ...act }),

    listActivity: (id: string) =>
      request<{ activity: ActivityDto[] }>('GET', `${base}/tasks/${id}/activity`).then(
        (r) => r.activity,
      ),

    setAssigneeStatus: (id: string, memberId: string, input: SetAssigneeStatusInput) =>
      request<{ task: TaskDto }>('PUT', `${base}/tasks/${id}/assignees/${memberId}/status`, {
        body: input,
        ...act,
      }).then((r) => r.task),

    reopenTask: (id: string, input: ReopenTaskInput) =>
      request<{ task: TaskDto }>('POST', `${base}/tasks/${id}/reopen`, { body: input, ...act }).then(
        (r) => r.task,
      ),

    editNote: (id: string, input: EditNoteInput) =>
      request<{ task: TaskDto }>('PUT', `${base}/tasks/${id}/note`, { body: input, ...act }).then(
        (r) => r.task,
      ),

    clearNote: (id: string, input: { expectedNoteVersion: number; reason?: string | undefined }) =>
      request<{ task: TaskDto }>('DELETE', `${base}/tasks/${id}/note`, { query: input, ...act }).then(
        (r) => r.task,
      ),

    listNoteRevisions: (id: string) =>
      request<{ revisions: NoteRevisionDto[] }>('GET', `${base}/tasks/${id}/note/revisions`).then(
        (r) => r.revisions,
      ),
  }
}

export type ProjectApi = ReturnType<typeof createProjectApi>

/** Calls that belong to the person entering or leaving a Collabo, not to something inside it. */
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
}
