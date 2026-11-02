/** Default, user-safe message for every error code the API can return. */
export const API_ERROR_MESSAGES = {
  INVALID_CODE: "That code doesn't match any Collabo.",
  RATE_LIMITED: 'Too many attempts. Please wait a few minutes and try again.',
  UNAUTHENTICATED: 'Enter your Collabo code to continue.',
  SESSION_INVALID: 'Your access has expired or the code was changed. Enter the code again.',
  FORBIDDEN_ORIGIN: 'This request was blocked.',
  PROJECT_NOT_FOUND: 'That Collabo could not be found.',
  PROJECT_SUSPENDED:
    'This Collabo has been suspended by a platform administrator. Contact them to restore access.',
  PROJECT_STATE_INVALID: "That isn't possible for a project in its current state.",
  MEMBER_REQUIRED: 'Choose who you are before making changes.',
  MEMBER_NOT_FOUND: "That person isn't part of this Collabo.",
  MEMBER_EXISTS: 'Someone with that name is already in this Collabo.',
  LAST_MEMBER: 'A Collabo needs at least one member.',
  MEMBER_HAS_OPEN_TASKS:
    'This person still has unfinished tasks. Reassign or remove them from those tasks first.',
  NOT_ASSIGNED: 'Only people assigned to this task can do that.',
  LAST_ASSIGNEE: 'A task needs at least one assignee.',
  TASK_COMPLETED: 'This task is already completed for the group. Reopen it to continue.',
  MODE_CHANGE_NEEDS_CONFIRMATION:
    'This task already has progress. Confirm that you want to change who needs to complete it.',
  REOPEN_NOT_APPLICABLE: 'That task is not completed for the group, so there is nothing to reopen.',
  NOTE_EMPTY: 'The note cannot be empty. Use "Clear note" to remove it deliberately.',
  NOTE_CONFLICT:
    'The progress note changed since you last refreshed. Refresh to see the latest version before editing it.',
  ASSIGNEE_CONFLICT:
    "This person's progress changed since you last refreshed. Refresh the task and try again.",
  REASON_REQUIRED: 'A reason is required for this action.',
  TASK_NOT_FOUND: 'That task could not be found. It may have been deleted.',
  TASK_CONFLICT: 'This task has changed since you last refreshed. Refresh it before editing.',
  ADMIN_REQUIRED: 'Sign in as a platform administrator to continue.',
  ADMIN_FORBIDDEN: 'This administrator account is not allowed to do that.',
  MFA_REQUIRED: 'Set up two-factor authentication to use the admin area.',
  PASSWORD_CHANGE_REQUIRED: 'Choose a new password before continuing.',
  ADMIN_NOT_CONFIGURED: 'Platform administration is not configured on this deployment.',
  ADMIN_EXISTS: 'An administrator with that email already exists.',
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
    /** Field name -> messages for VALIDATION_ERROR; structured context for some other errors. */
    details?: Record<string, unknown>
  }
}
