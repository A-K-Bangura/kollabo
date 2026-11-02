import { zodResolver } from '@hookform/resolvers/zod'
import { LIMITS, MODE_LABELS, PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES } from '@shared/constants'
import type { CreateTaskInput, UpdateTaskInput } from '@shared/schemas'
import {
  assignmentModeSchema,
  dueDateSchema,
  reasonSchema,
  taskPrioritySchema,
  taskTitleSchema,
} from '@shared/schemas'
import { describeModeChange } from '@shared/task-progress'
import type { TaskDto } from '@shared/types'
import { addDays } from 'date-fns'
import { useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { PromptDialog } from '@/components/ui/Dialog'
import { InlineAlert } from '@/components/ui/feedback'
import { TextAreaField, TextField } from '@/components/ui/fields'
import { Segmented } from '@/components/ui/Segmented'
import { useProjectScope } from '@/features/scope/scope'
import { useReportError } from '@/features/session/hooks'
import { useMemberLookup } from '@/features/team/hooks'
import { ApiClientError, isConflict } from '@/lib/api'
import { cn } from '@/lib/cn'
import { toDateKey } from '@/lib/dates'
import { AssigneePicker } from './AssigneePicker'
import { useCreateTask, useRefreshAction, useUpdateTask } from './hooks'

const formSchema = z.object({
  title: taskTitleSchema,
  description: z
    .string()
    .max(LIMITS.taskDescription, `Description must be ${LIMITS.taskDescription} characters or fewer`),
  assigneeIds: z.array(z.string()).min(1, 'Choose at least one person'),
  assignmentMode: assignmentModeSchema,
  /** '' means no due date. */
  dueDate: z.union([z.literal(''), dueDateSchema]),
  priority: taskPrioritySchema,
  /** Why an administrator is making this change (optional; recorded in the audit log). */
  reason: z.union([z.literal(''), reasonSchema]),
})

type FormValues = z.infer<typeof formSchema>

function initialValues(task: TaskDto | undefined, defaults: { dueDate: string | null; me: string | null }): FormValues {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    assigneeIds: task ? task.assignees.map((assignee) => assignee.memberId) : defaults.me ? [defaults.me] : [],
    assignmentMode: task?.assignmentMode ?? 'all',
    dueDate: task?.dueDate ?? defaults.dueDate ?? '',
    priority: task?.priority ?? 'medium',
    reason: '',
  }
}

interface TaskFormProps {
  /** Present when editing; absent when creating. */
  task?: TaskDto
  defaultDueDate?: string | null
  onDone: () => void
  onCancel: () => void
}

const MODE_OPTIONS = [
  {
    value: 'all' as const,
    label: MODE_LABELS.all,
    description: 'Each person finishes their own part. The task is done when everyone has.',
  },
  {
    value: 'any' as const,
    label: MODE_LABELS.any,
    description: 'Whoever gets to it first can finish it for everyone.',
  },
]

/** What switching who has to finish will do to a task that already has progress. */
function modeChangeExplanation(task: TaskDto, to: 'all' | 'any'): string {
  const { before, after, changesStatus } = describeModeChange(
    task.assignmentMode,
    to,
    task.status,
    task.assignees,
  )
  const rule =
    to === 'any'
      ? 'From now on, one person marking it done finishes it for everyone.'
      : 'From now on, everyone must finish their own part. Only parts already marked done count.'
  const effect = changesStatus
    ? ` The task will change from ${STATUS_LABELS[before]} to ${STATUS_LABELS[after]}.`
    : ` The task stays ${STATUS_LABELS[before]}.`
  return rule + effect
}

/** The one task form: used to create a task and to edit one. */
export function TaskForm({ task, defaultDueDate = null, onDone, onCancel }: TaskFormProps) {
  const scope = useProjectScope()
  const { members } = useMemberLookup()
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialValues(task, { dueDate: defaultDueDate, me: scope.me?.id ?? null }),
  })
  const { register, handleSubmit, setValue, watch, formState } = form
  // Read during render on purpose: react-hook-form only tracks the formState
  // fields that are read while rendering, so reading isDirty later would be stale.
  const { errors, isDirty } = formState
  const create = useCreateTask()
  const update = useUpdateTask()
  const refreshAll = useRefreshAction()
  const report = useReportError()
  const [conflict, setConflict] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [pending, setPending] = useState<FormValues | null>(null)

  const assigneeIds = watch('assigneeIds')
  const mode = watch('assignmentMode')
  const isAdmin = scope.viewer === 'admin'

  const setDueDate = (date: Date | null) =>
    setValue('dueDate', date ? toDateKey(date) : '', { shouldDirty: true, shouldValidate: true })

  // Adding someone whose part is not done re-opens a finished "everyone" task.
  const reopensTask = useMemo(() => {
    if (!task || task.status !== 'completed' || task.assignmentMode !== 'all') return false
    const existing = new Set(task.assignees.map((assignee) => assignee.memberId))
    return assigneeIds.some((id) => !existing.has(id))
  }, [task, assigneeIds])

  const send = (values: FormValues, confirmModeChange: boolean) => {
    const changes: Omit<UpdateTaskInput, 'expectedVersion'> = {
      title: values.title,
      description: values.description.trim() || null,
      assigneeIds: values.assigneeIds,
      assignmentMode: values.assignmentMode,
      dueDate: values.dueDate || null,
      priority: values.priority,
      ...(confirmModeChange ? { confirmModeChange: true } : {}),
      ...(values.reason ? { reason: values.reason } : {}),
    }

    if (!task) {
      const input: CreateTaskInput = {
        title: changes.title!,
        description: changes.description ?? null,
        assigneeIds: values.assigneeIds,
        assignmentMode: values.assignmentMode,
        dueDate: changes.dueDate ?? null,
        priority: values.priority,
      }
      create.mutate(input, {
        onSuccess: () => {
          toast.success('Task added')
          onDone()
        },
      })
      return
    }

    update.mutate(
      { task, changes },
      {
        onSuccess: () => {
          setPending(null)
          toast.success('Task updated')
          onDone()
        },
        onError: (error) => {
          setPending(null)
          if (isConflict(error)) setConflict(true)
          else if (error instanceof ApiClientError && error.code === 'MODE_CHANGE_NEEDS_CONFIRMATION') {
            setPending(values)
          } else report(error)
        },
      },
    )
  }

  const onSubmit = handleSubmit((values) => {
    if (task && !isDirty) {
      onDone()
      return
    }
    if (task && values.assignmentMode !== task.assignmentMode) {
      const { needsConfirmation } = describeModeChange(
        task.assignmentMode,
        values.assignmentMode,
        task.status,
        task.assignees,
      )
      if (needsConfirmation) {
        setPending(values)
        return
      }
    }
    send(values, false)
  })

  const refresh = async () => {
    setRefreshing(true)
    try {
      await refreshAll()
      setConflict(false)
    } finally {
      setRefreshing(false)
    }
  }

  const busy = create.isPending || update.isPending

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      {conflict && (
        <InlineAlert
          tone="warn"
          action={
            <Button size="sm" variant="secondary" onClick={() => void refresh()} loading={refreshing}>
              Refresh
            </Button>
          }
        >
          This task has changed since you last refreshed. Refresh it before editing.
        </InlineAlert>
      )}

      <TextField
        label="Title"
        autoFocus={!task}
        autoComplete="off"
        maxLength={LIMITS.taskTitle + 20}
        placeholder="What needs doing?"
        error={errors.title?.message}
        {...register('title')}
      />

      <TextAreaField
        label="Description (optional)"
        placeholder="Anything the team should know"
        error={errors.description?.message}
        {...register('description')}
      />

      <AssigneePicker
        members={members}
        value={assigneeIds}
        onChange={(ids) => setValue('assigneeIds', ids, { shouldDirty: true, shouldValidate: true })}
        error={errors.assigneeIds?.message}
      />

      <Segmented
        legend="Who needs to finish it?"
        value={mode}
        onChange={(value) => setValue('assignmentMode', value, { shouldDirty: true })}
        options={MODE_OPTIONS}
        disabled={assigneeIds.length < 2 && !task}
      />
      {assigneeIds.length < 2 && (
        <p className="-mt-3 text-sm text-muted">This only matters once two or more people are assigned.</p>
      )}

      {reopensTask && (
        <InlineAlert tone="warn">
          Adding people reopens this task, because their part isn’t done yet.
        </InlineAlert>
      )}

      <div className="flex flex-col gap-2">
        <TextField label="Due date" type="date" error={errors.dueDate?.message} {...register('dueDate')} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setDueDate(new Date())}>
            Today
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDueDate(addDays(new Date(), 1))}>
            Tomorrow
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDueDate(null)}>
            Clear
          </Button>
        </div>
      </div>

      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-medium">Priority</legend>
        <div className="grid grid-cols-3 gap-1 rounded-xl bg-raised p-1">
          {TASK_PRIORITIES.map((priority) => (
            <label key={priority} className="relative">
              <input type="radio" value={priority} className="peer sr-only" {...register('priority')} />
              <span
                className={cn(
                  'flex h-11 items-center justify-center rounded-lg text-sm font-medium text-muted transition',
                  'peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-sm',
                  'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                )}
              >
                {PRIORITY_LABELS[priority]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {isAdmin && task && (
        <TextAreaField
          label="Reason (optional)"
          hint="Recorded in the admin audit log. Members never see it."
          rows={2}
          error={errors.reason?.message}
          {...register('reason')}
        />
      )}

      <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-2 border-t border-line bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" loading={busy}>
          {task ? 'Save changes' : 'Add task'}
        </Button>
      </div>

      <PromptDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        title="Change who needs to finish this?"
        description={
          task && pending ? modeChangeExplanation(task, pending.assignmentMode) : ''
        }
        confirmLabel="Change it"
        loading={update.isPending}
        onConfirm={() => pending && send(pending, true)}
      />
    </form>
  )
}
