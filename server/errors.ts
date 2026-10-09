import { API_ERROR_MESSAGES, type ApiErrorCode } from '../shared/errors.js'

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_CODE: 401,
  RATE_LIMITED: 429,
  UNAUTHENTICATED: 401,
  SESSION_INVALID: 401,
  FORBIDDEN_ORIGIN: 403,
  PROJECT_NOT_FOUND: 404,
  MEMBER_REQUIRED: 400,
  MEMBER_NOT_FOUND: 404,
  MEMBER_EXISTS: 409,
  LAST_MEMBER: 409,
  TASK_NOT_FOUND: 404,
  TASK_CONFLICT: 409,
  VALIDATION_ERROR: 400,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  SERVER_ERROR: 500,
}

interface ApiErrorOptions {
  message?: string
  details?: Record<string, string[]>
  headers?: Record<string, string>
}

/** An expected failure with a stable code. Everything else becomes a generic 500. */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly details: Record<string, string[]> | undefined
  readonly headers: Record<string, string>

  constructor(code: ApiErrorCode, options: ApiErrorOptions = {}) {
    super(options.message ?? API_ERROR_MESSAGES[code])
    this.name = 'ApiError'
    this.code = code
    this.status = STATUS_BY_CODE[code]
    this.details = options.details
    this.headers = options.headers ?? {}
  }
}

/** Postgres SQLSTATE of an error (drizzle wraps driver errors in `cause`). */
export function pgErrorCode(error: unknown): string | undefined {
  let current: unknown = error
  for (let depth = 0; depth < 4 && typeof current === 'object' && current !== null; depth += 1) {
    const code = (current as { code?: unknown }).code
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code
    current = (current as { cause?: unknown }).cause
  }
  return undefined
}

export const UNIQUE_VIOLATION = '23505'
