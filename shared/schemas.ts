import { z } from 'zod'
import { normalizeAccessCode } from './access-code.js'
import {
  ASSIGNMENT_MODES,
  LIMITS,
  PROJECT_STATUSES,
  TASK_PRIORITIES,
  TASK_STATUSES,
} from './constants.js'

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`)

export const projectNameSchema = requiredText('Collabo name', LIMITS.projectName)

export const personNameSchema = requiredText('Name', LIMITS.personName).transform((value) =>
  value.replace(/\s+/g, ' '),
)

export const taskTitleSchema = requiredText('Title', LIMITS.taskTitle)

/** Empty text is stored as no description at all. */
export const taskDescriptionSchema = z
  .string()
  .trim()
  .max(LIMITS.taskDescription, `Description must be ${LIMITS.taskDescription} characters or fewer`)
  .nullable()
  .transform((value) => (value === null || value === '' ? null : value))

export const uuidSchema = z.uuid('Invalid id')

/** A calendar date such as 2026-10-10 (never a timestamp, so no timezone drift). */
export const dueDateSchema = z.iso.date('Use a valid date')

export const taskStatusSchema = z.enum(TASK_STATUSES)
export const assignmentModeSchema = z.enum(ASSIGNMENT_MODES)

/** The shared progress note: plain text, never HTML. Blank is not allowed (clearing is its own action). */
export const progressNoteSchema = z
  .string()
  .trim()
  .min(1, 'Write something, or use "Clear note" to remove it')
  .max(LIMITS.progressNote, `The note must be ${LIMITS.progressNote} characters or fewer`)

/**
 * A note sent along with a progress change. Blank means "leave the existing note alone":
 * an empty optional field is never confused with deliberately clearing the note.
 */
const optionalNoteSchema = z
  .string()
  .trim()
  .max(LIMITS.progressNote, `The note must be ${LIMITS.progressNote} characters or fewer`)
  .optional()
  .transform((value) => (value === '' ? undefined : value))

/** Why a privileged action was taken. Recorded in the audit log. */
export const reasonSchema = z
  .string()
  .trim()
  .min(3, 'Give a short reason')
  .max(LIMITS.reason, `The reason must be ${LIMITS.reason} characters or fewer`)

const noteVersionSchema = z.number().int().min(0)

/** A list of member ids with duplicates removed (order kept). */
const memberIdListSchema = z
  .array(uuidSchema)
  .min(1, 'Choose at least one person')
  .transform((ids) => [...new Set(ids)])
export const taskPrioritySchema = z.enum(TASK_PRIORITIES)

export const accessCodeSchema = z
  .string()
  .max(64, 'That code is too long')
  .transform((value, ctx) => {
    const code = normalizeAccessCode(value)
    if (code === null) {
      ctx.issues.push({
        code: 'custom',
        message: 'Enter a code like K7QM-2XPA-9WTH',
        input: value,
      })
      return z.NEVER
    }
    return code
  })

export const createProjectSchema = z.object({
  name: projectNameSchema,
  creatorName: personNameSchema,
  memberNames: z.array(personNameSchema).max(LIMITS.membersPerRequest).default([]),
})

export const createSessionSchema = z.object({ code: accessCodeSchema })

/** Add one person (`name`) or several at once (`names`, e.g. pasted from a list). */
export const createMemberSchema = z
  .object({
    name: personNameSchema.optional(),
    names: z.array(personNameSchema).min(1).max(LIMITS.membersPerRequest).optional(),
  })
  .refine((input) => input.name !== undefined || input.names !== undefined, {
    message: 'Enter a name',
    path: ['name'],
  })

export const renameMemberSchema = z.object({ name: personNameSchema })

/** Deactivating a member who still has unfinished work needs a decision about that work. */
export const deactivateMemberSchema = z.object({
  reassignToMemberId: uuidSchema.nullable().optional(),
})

export const createTaskSchema = z
  .object({
    title: taskTitleSchema,
    description: taskDescriptionSchema.optional(),
    /** The people responsible. At least one is required. */
    assigneeIds: memberIdListSchema.optional(),
    /** V1 compatibility: a single assignee. Equivalent to assigneeIds: [id]. */
    assignedToMemberId: uuidSchema.nullable().optional(),
    assignmentMode: assignmentModeSchema.default('all'),
    dueDate: dueDateSchema.nullable().optional(),
    priority: taskPrioritySchema.default('medium'),
  })
  .refine((input) => (input.assigneeIds?.length ?? 0) > 0 || !!input.assignedToMemberId, {
    message: 'Choose at least one person',
    path: ['assigneeIds'],
  })

const UPDATABLE_TASK_FIELDS = [
  'title',
  'description',
  'assigneeIds',
  'assignedToMemberId',
  'assignmentMode',
  'dueDate',
  'priority',
] as const

/**
 * Edits the task itself (details, who is assigned, who must complete it). A person's
 * own progress is not edited here: see setAssigneeStatusSchema.
 */
export const updateTaskSchema = z
  .object({
    /** The task `version` the editor loaded. A mismatch means a 409 conflict. */
    expectedVersion: z.number().int().min(1),
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    assigneeIds: memberIdListSchema.optional(),
    assignedToMemberId: uuidSchema.nullable().optional(),
    assignmentMode: assignmentModeSchema.optional(),
    /** Required when switching modes on a task that already has progress. */
    confirmModeChange: z.boolean().optional(),
    dueDate: dueDateSchema.nullable().optional(),
    priority: taskPrioritySchema.optional(),
    /** V1 allowed setting the task's status directly. Overall status now follows the assignees. */
    status: z.unknown().optional(),
    reason: reasonSchema.optional(),
  })
  .refine((input) => input.status === undefined, {
    message: 'A task’s status follows its assignees. Change someone’s progress instead.',
    path: ['status'],
  })
  .refine(
    (input) =>
      UPDATABLE_TASK_FIELDS.some((field) => input[field] !== undefined),
    { message: 'Nothing to update.' },
  )

/** One person's own progress (or, for ANY tasks, completing the task for the group). */
export const setAssigneeStatusSchema = z
  .object({
    status: taskStatusSchema,
    /** The assignee's `version` the caller loaded: others progressing does not conflict, only changes to this person do. */
    expectedAssigneeVersion: z.number().int().min(1),
    /** Optional: replaces the shared note. Leave out to keep the existing note. */
    note: optionalNoteSchema,
    expectedNoteVersion: noteVersionSchema.optional(),
    /** Required when an admin changes someone else's progress. */
    reason: reasonSchema.optional(),
  })
  .refine((input) => input.note === undefined || input.expectedNoteVersion !== undefined, {
    message: 'expectedNoteVersion is required when sending a note',
    path: ['expectedNoteVersion'],
  })

/** Explicitly reopen a task that was completed for the group (ANY mode). */
export const reopenTaskSchema = z
  .object({
    expectedVersion: z.number().int().min(1),
    note: optionalNoteSchema,
    expectedNoteVersion: noteVersionSchema.optional(),
    reason: reasonSchema.optional(),
  })
  .refine((input) => input.note === undefined || input.expectedNoteVersion !== undefined, {
    message: 'expectedNoteVersion is required when sending a note',
    path: ['expectedNoteVersion'],
  })

export const editNoteSchema = z.object({
  content: progressNoteSchema,
  expectedNoteVersion: noteVersionSchema,
  reason: reasonSchema.optional(),
})

/** `?limit=` and `?before=` for histories (activity ids, note revision numbers). */
export const historyQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(100),
  before: z.coerce.number().int().min(1).optional(),
})

/** Page-numbered listings (admin directories). */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(LIMITS.pageSize),
  page: z.coerce.number().int().min(1).default(1),
})

/* -------------------------------------------------------------------------- */
/* Platform administration                                                    */
/* -------------------------------------------------------------------------- */

/** `?search=&status=&sort=` for the admin project directory. */
export const adminProjectsQuerySchema = pageQuerySchema.extend({
  search: z.string().trim().max(80).optional(),
  status: z.enum(['all', ...PROJECT_STATUSES]).default('all'),
  sort: z.enum(['activity', 'name', 'created', 'size']).default('activity'),
})

/** `?projectId=&adminId=&action=` for the audit log. */
export const adminAuditQuerySchema = pageQuerySchema.extend({
  projectId: uuidSchema.optional(),
  adminId: z.string().trim().min(1).max(64).optional(),
  action: z.string().trim().min(1).max(64).optional(),
})

/** Actions that must always be explained. */
export const requiredReasonBodySchema = z.object({ reason: reasonSchema })

/** Actions where explaining is optional (it is recorded when given). */
export const optionalReasonBodySchema = z.object({ reason: reasonSchema.optional() })

export const adminRenameProjectSchema = z.object({
  name: projectNameSchema,
  reason: reasonSchema.optional(),
})

export const adminEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'Email must be 254 characters or fewer')
  .pipe(z.email('Enter a valid email address'))

export const createAdminSchema = z.object({
  name: personNameSchema,
  email: adminEmailSchema,
})

/** What the browser sends (before defaults and transforms are applied). */
export type CreateProjectInput = z.input<typeof createProjectSchema>
export type CreateTaskInput = z.input<typeof createTaskSchema>
export type UpdateTaskInput = z.input<typeof updateTaskSchema>
export type SetAssigneeStatusInput = z.input<typeof setAssigneeStatusSchema>
export type ReopenTaskInput = z.input<typeof reopenTaskSchema>
export type EditNoteInput = z.input<typeof editNoteSchema>
