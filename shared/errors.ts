/** Default, user-safe message for every error code the API can return. */
export const API_ERROR_MESSAGES = {
  INVALID_CODE: "That code doesn't match any Collabo.",
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  UNAUTHENTICATED: 'Enter your Collabo code to continue.',
  SESSION_INVALID: 'Your access has expired or the code was changed. Enter the code again.',
  FORBIDDEN_ORIGIN: 'This request was blocked.',
  PROJECT_NOT_FOUND: 'That Collabo could not be found.',
  MEMBER_REQUIRED: 'Choose who you are before making changes.',
  MEMBER_NOT_FOUND: "That person isn't part of this Collabo.",
  MEMBER_EXISTS: 'Someone with that name is already in this Collabo.',
  LAST_MEMBER: 'A Collabo needs at least one member.',
  TASK_NOT_FOUND: 'That task could not be found. It may have been deleted.',
  TASK_CONFLICT: 'This task has changed since you last refreshed. Refresh it before editing.',
  VALIDATION_ERROR: 'Some details need another look.',
  PAYLOAD_TOO_LARGE: 'That request is too large.',
  UNSUPPORTED_MEDIA_TYPE: 'Requests must be sent as JSON.',
  NOT_FOUND: 'No such API route.',
  METHOD_NOT_ALLOWED: 'Method not allowed.',
  SERVER_ERROR: 'Something went wrong on our side. Please try again.',
} as const

export type ApiErrorCode = keyof typeof API_ERROR_MESSAGES

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode
    message: string
    /** Field name -> messages. Only present for VALIDATION_ERROR. */
    details?: Record<string, string[]>
  }
}
