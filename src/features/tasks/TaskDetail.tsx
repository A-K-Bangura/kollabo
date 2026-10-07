import { PRIORITY_LABELS } from '@shared/constants'
import type { TaskDto } from '@shared/types'
import { format, parseISO } from 'date-fns'
import { Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { useMemberLookup } from '@/features/team/hooks'
import { ApiClientError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDueDate, parseDateKey, todayKey } from '@/lib/dates'
import { ActivityList } from './ActivityList'
import { useChangeStatus, useDeleteTask, useTaskQuery } from './hooks'
import { isOverdue } from './lib'
import { StatusControl } from './StatusControl'
import { TaskForm } from './TaskForm'

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] font-medium">{children}</dd>
    </div>
  )
}

function dueLabel(task: TaskDto): string {
  if (!task.dueDate) return 'No due date'
  const relative = formatDueDate(task.dueDate)
  const full = format(parseDateKey(task.dueDate), 'EEE, MMM d')
  return ['Today', 'Tomorrow', 'Yesterday'].includes(relative) ? `${relative} · ${full}` : relative
}

function TaskView({ task, onClose }: { task: TaskDto; onClose: () => void }) {
  const { find } = useMemberLookup()
  const { change, isPending } = useChangeStatus()
  const remove = useDeleteTask()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const assignee = find(task.assignedToMemberId)
  const completedBy = find(task.completedByMemberId)

  if (editing) {
    return (
      // Keyed by version: after a refresh brings in someone else's change, the
      // form starts again from the newer data instead of silently keeping stale values.
      <TaskForm
        key={task.version}
        task={task}
        onDone={() => setEditing(false)}
        onCancel={() => setEditing(false)}
      />
    )
  }

  const overdue = isOverdue(task, todayKey())

  return (
    <div className="flex flex-col gap-6">
      <h3
        className={cn(
          'text-xl font-semibold leading-snug [overflow-wrap:anywhere]',
          task.status === 'completed' && 'text-muted',
        )}
      >
        {task.title}
      </h3>

      <StatusControl value={task.status} onChange={(status) => change(task, status)} disabled={isPending} />

      <dl className="divide-y divide-line rounded-2xl border border-line px-4 py-4">
        <Detail label="Assigned to">
          {assignee ? (
            <span className="inline-flex items-center gap-2">
              <Avatar name={assignee.name} className="size-6 text-xs" />
              {assignee.name}
              {!assignee.isActive && <span className="font-normal text-muted">(removed)</span>}
            </span>
          ) : (
            <span className="font-normal text-muted">Unassigned</span>
          )}
        </Detail>
        <Detail label="Due">
          <span className={cn(overdue && 'text-danger')}>{dueLabel(task)}</span>
        </Detail>
        <Detail label="Priority">{PRIORITY_LABELS[task.priority]}</Detail>
        {task.status === 'completed' && task.completedAt && (
          <Detail label="Completed">
            {completedBy?.name ?? 'Someone'} · {format(parseISO(task.completedAt), 'MMM d, h:mm a')}
          </Detail>
        )}
      </dl>

      {task.description && (
        <section aria-labelledby="description-heading">
          <h3 id="description-heading" className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            Description
          </h3>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">
            {task.description}
          </p>
        </section>
      )}

      <ActivityList taskId={task.id} />

      <div className="flex gap-2 border-t border-line pt-5">
        <Button variant="secondary" className="flex-1" onClick={() => setEditing(true)}>
          <Pencil className="size-4" aria-hidden />
          Edit
        </Button>
        <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => setConfirmingDelete(true)}>
          <Trash2 className="size-4" aria-hidden />
          Delete
        </Button>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        title={`Delete “${task.title}”?`}
        description="This will remove the task from the Collabo."
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={() =>
          remove.mutate(task, {
            onSuccess: () => {
              toast.success('Task deleted')
              setConfirmingDelete(false)
              onClose()
            },
          })
        }
      />
    </div>
  )
}

export function TaskDetail({ taskId, onClose }: { taskId: string; onClose: () => void }) {
  const task = useTaskQuery(taskId)

  if (task.isPending) {
    return (
      <div role="status" aria-label="Loading task" className="space-y-4">
        <Skeleton className="h-7 w-3/4" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (task.isError) {
    if (task.error instanceof ApiClientError && task.error.code === 'TASK_NOT_FOUND') {
      return (
        <EmptyState
          title="This task no longer exists"
          description="It may have been deleted by someone else."
          action={<Button onClick={onClose}>Close</Button>}
        />
      )
    }
    return <ErrorState message={task.error.message} onRetry={() => void task.refetch()} />
  }

  return <TaskView task={task.data} onClose={onClose} />
}
