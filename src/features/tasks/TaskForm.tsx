import { zodResolver } from '@hookform/resolvers/zod'
import { LIMITS, PRIORITY_LABELS, TASK_PRIORITIES } from '@shared/constants'
import type { CreateTaskInput } from '@shared/schemas'
import { dueDateSchema, taskPrioritySchema, taskTitleSchema } from '@shared/schemas'
import type { TaskDto } from '@shared/types'
import { addDays } from 'date-fns'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/feedback'
import { SelectField, TextAreaField, TextField } from '@/components/ui/fields'
import { useReportError } from '@/features/session/hooks'
import { useMemberLookup } from '@/features/team/hooks'
import { isConflict } from '@/lib/api'
import { cn } from '@/lib/cn'
import { toDateKey } from '@/lib/dates'
import { useCreateTask, useRefreshAction, useUpdateTask } from './hooks'

const formSchema = z.object({
  title: taskTitleSchema,
  description: z
    .string()
    .max(LIMITS.taskDescription, `Description must be ${LIMITS.taskDescription} characters or fewer`),
  /** '' means unassigned. */
  assignedToMemberId: z.string(),
  /** '' means no due date. */
  dueDate: z.union([z.literal(''), dueDateSchema]),
  priority: taskPrioritySchema,
})

type FormValues = z.infer<typeof formSchema>

function initialValues(task: TaskDto | undefined, defaultDueDate: string | null): FormValues {
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    assignedToMemberId: task?.assignedToMemberId ?? '',
    dueDate: task?.dueDate ?? defaultDueDate ?? '',
    priority: task?.priority ?? 'medium',
  }
}

interface TaskFormProps {
  /** Present when editing; absent when creating. */
  task?: TaskDto
  defaultDueDate?: string | null
  onDone: () => void
  onCancel: () => void
}

/** The one task form: used to create a task and to edit one. */
export function TaskForm({ task, defaultDueDate = null, onDone, onCancel }: TaskFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: initialValues(task, defaultDueDate),
  })
  const { register, handleSubmit, setValue, formState } = form
  // Read during render on purpose: react-hook-form only tracks the formState
  // fields that are read while rendering, so reading isDirty later would be stale.
  const { errors, isDirty } = formState
  const { activeMembers, find } = useMemberLookup()
  const create = useCreateTask()
  const update = useUpdateTask()
  const refreshAll = useRefreshAction()
  const report = useReportError()
  const [conflict, setConflict] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // A removed member who already owns the task stays selectable so the form is truthful.
  const currentAssignee = find(task?.assignedToMemberId ?? null)
  const assigneeOptions =
    currentAssignee && !currentAssignee.isActive ? [...activeMembers, currentAssignee] : activeMembers

  const setDueDate = (date: Date | null) =>
    setValue('dueDate', date ? toDateKey(date) : '', { shouldDirty: true, shouldValidate: true })

  const onSubmit = handleSubmit((values) => {
    const input: CreateTaskInput = {
      title: values.title,
      description: values.description.trim() || null,
      assignedToMemberId: values.assignedToMemberId || null,
      dueDate: values.dueDate || null,
      priority: values.priority,
    }

    if (!task) {
      create.mutate(input, {
        onSuccess: () => {
          toast.success('Task added')
          onDone()
        },
      })
      return
    }

    if (!isDirty) {
      onDone()
      return
    }
    update.mutate(
      { task, changes: input },
      {
        onSuccess: () => {
          toast.success('Task updated')
          onDone()
        },
        onError: (error) => (isConflict(error) ? setConflict(true) : report(error)),
      },
    )
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

      <SelectField label="Assigned to" {...register('assignedToMemberId')}>
        <option value="">Unassigned</option>
        {assigneeOptions.map((member) => (
          <option key={member.id} value={member.id}>
            {member.name}
            {member.isActive ? '' : ' (removed)'}
          </option>
        ))}
      </SelectField>

      <div className="flex flex-col gap-2">
        <TextField
          label="Due date"
          type="date"
          error={errors.dueDate?.message}
          {...register('dueDate')}
        />
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
              <input
                type="radio"
                value={priority}
                className="peer sr-only"
                {...register('priority')}
              />
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

      <div className="sticky bottom-0 -mx-5 -mb-5 flex gap-2 border-t border-line bg-surface px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
        <Button variant="secondary" className="flex-1" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" className="flex-1" loading={busy}>
          {task ? 'Save changes' : 'Add task'}
        </Button>
      </div>
    </form>
  )
}
