import { z } from 'zod'
import { normalizeAccessCode } from './access-code.js'
import { LIMITS, TASK_PRIORITIES, TASK_STATUSES } from './constants.js'

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
  memberNames: z.array(personNameSchema).max(LIMITS.extraMembersOnCreate).default([]),
})

export const createSessionSchema = z.object({ code: accessCodeSchema })

export const createMemberSchema = z.object({ name: personNameSchema })

export const createTaskSchema = z.object({
  title: taskTitleSchema,
  description: taskDescriptionSchema.optional(),
  assignedToMemberId: uuidSchema.nullable().optional(),
  dueDate: dueDateSchema.nullable().optional(),
  priority: taskPrioritySchema.default('medium'),
})

const UPDATABLE_TASK_FIELDS = [
  'title',
  'description',
  'assignedToMemberId',
  'dueDate',
  'priority',
  'status',
] as const

export const updateTaskSchema = z
  .object({
    /** The task `version` the editor loaded. A mismatch means a 409 conflict. */
    expectedVersion: z.number().int().min(1),
    title: taskTitleSchema.optional(),
    description: taskDescriptionSchema.optional(),
    assignedToMemberId: uuidSchema.nullable().optional(),
    dueDate: dueDateSchema.nullable().optional(),
    priority: taskPrioritySchema.optional(),
    status: taskStatusSchema.optional(),
  })
  .refine((input) => UPDATABLE_TASK_FIELDS.some((field) => input[field] !== undefined), {
    message: 'Nothing to update.',
  })

/** What the browser sends (before defaults and transforms are applied). */
export type CreateProjectInput = z.input<typeof createProjectSchema>
export type CreateTaskInput = z.input<typeof createTaskSchema>
export type UpdateTaskInput = z.input<typeof updateTaskSchema>
