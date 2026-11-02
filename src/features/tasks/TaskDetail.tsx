import { MODE_LABELS, PRIORITY_LABELS, STATUS_LABELS, TASK_STATUSES } from '@shared/constants'
import { progressCounts } from '@shared/task-progress'
import type { TaskDto } from '@shared/types'
import { format, parseISO } from 'date-fns'
import { Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog, PromptDialog } from '@/components/ui/Dialog'
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback'
import { TextAreaField } from '@/components/ui/fields'
import { useProjectScope } from '@/features/scope/useScope'
import { useMemberLookup } from '@/features/team/hooks'
import { ApiClientError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { formatDueDate, parseDateKey, todayKey } from '@/lib/dates'
import { ActivityList } from './ActivityList'
import { useDeleteTask, useTaskQuery } from './hooks'
import { isOverdue, progressAccess } from './lib'
import { NoteSection } from './NoteSection'
import { ProgressDialog, type ProgressIntent } from './ProgressDialog'
import { StatusIcon } from './StatusIcon'
import { TaskForm } from './TaskForm'

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="min-w-0 text-right text-[15px] font-medium">{children}</dd>
    </div>
  )
}

function SectionTitle({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h3 id={id} className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
      {children}
    </h3>
  )
}

function dueLabel(task: TaskDto): string {
  if (!task.dueDate) return 'No due date'
  const relative = formatDueDate(task.dueDate)
  const full = format(parseDateKey(task.dueDate), 'EEE, MMM d')
  return ['Today', 'Tomorrow', 'Yesterday'].includes(relative) ? `${relative} · ${full}` : relative
}

/** One line that says where the task as a whole stands, in the terms of how it is shared. */
function summaryLine(task: TaskDto): string | null {
  if (task.assignees.length < 2) return null
  if (task.assignmentMode === 'all') {
    const { completed, total } = progressCounts(task.assignees)
    return `${completed} of ${total} parts done`
  }
  if (task.status === 'completed') {
    return task.completedBy ? `Finished for everyone by ${task.completedBy.name}` : 'Finished for everyone'
  }
  return 'Anyone assigned can finish this for the whole group'
}

function TaskView({ task, onClose }: { task: TaskDto; onClose: () => void }) {
  const scope = useProjectScope()
  const { find } = useMemberLookup()
  const remove = useDeleteTask()
  const [editing, setEditing] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deleteReason, setDeleteReason] = useState('')
  const [intent, setIntent] = useState<ProgressIntent | null>(null)

  const isAdmin = scope.viewer === 'admin'
  const access = progressAccess(task, scope.me?.id ?? null)
  const groupCompleted = task.assignmentMode === 'any' && task.status === 'completed'
  const canReopen = groupCompleted && (isAdmin || access.kind !== 'not-assigned')

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
  const summary = summaryLine(task)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3
          className={cn(
            'text-xl font-semibold leading-snug [overflow-wrap:anywhere]',
            task.status === 'completed' && 'text-muted',
          )}
        >
          {task.title}
        </h3>
        <p className="mt-2 flex items-center gap-2 text-[15px] font-medium">
          <StatusIcon status={task.status} className="size-5" />
          <span>{STATUS_LABELS[task.status]}</span>
          {summary && <span className="font-normal text-muted">· {summary}</span>}
        </p>
      </div>

      {groupCompleted && (
        <div className="flex flex-col gap-3 rounded-2xl bg-success-soft px-4 py-3.5 text-[15px] sm:flex-row sm:items-center sm:justify-between">
          <p className="text-success">
            <strong className="font-semibold">Done for everyone.</strong> Nobody’s progress changes now unless the task is reopened.
          </p>
          {canReopen && (
            <Button size="sm" variant="secondary" onClick={() => setIntent({ kind: 'reopen' })}>
              <RotateCcw className="size-4" aria-hidden />
              Reopen
            </Button>
          )}
        </div>
      )}

      {!isAdmin && (
        <section aria-labelledby="my-progress-heading">
          <SectionTitle id="my-progress-heading">Your progress</SectionTitle>
          {access.kind === 'not-assigned' ? (
            <p className="rounded-2xl border border-line px-4 py-3.5 text-[15px] text-muted">
              You’re not assigned to this task, so progress is up to the people below. You can still edit its details.
            </p>
          ) : (
            <>
              <div role="group" aria-label="Your progress" className="grid grid-cols-3 gap-1 rounded-xl bg-raised p-1">
                {TASK_STATUSES.map((status) => {
                  const selected = status === access.row.status
                  return (
                    <button
                      key={status}
                      type="button"
                      aria-pressed={selected}
                      disabled={access.kind === 'group-completed'}
                      onClick={() =>
                        !selected &&
                        scope.me &&
                        setIntent({ kind: 'status', memberId: scope.me.id, status })
                      }
                      className={cn(
                        'flex h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-medium transition sm:text-sm',
                        'disabled:opacity-60',
                        selected ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
                      )}
                    >
                      <StatusIcon status={status} className="size-5" />
                      <span className="truncate">{STATUS_LABELS[status]}</span>
                    </button>
                  )
                })}
              </div>
              {access.kind === 'group-completed' && (
                <p className="mt-2 text-sm text-muted">Reopen the task to change your progress.</p>
              )}
            </>
          )}
        </section>
      )}

      <section aria-labelledby="people-heading">
        <SectionTitle id="people-heading">
          {task.assignees.length === 1 ? 'Assigned to' : `Assigned to · ${task.assignees.length}`}
        </SectionTitle>
        {task.assignees.length === 0 ? (
          <p className="rounded-2xl border border-line px-4 py-3.5 text-[15px] text-muted">
            Nobody is assigned yet. Edit the task to choose who it’s for.
          </p>
        ) : (
          <ul className="max-h-72 divide-y divide-line overflow-y-auto overscroll-contain rounded-2xl border border-line">
            {task.assignees.map((assignee) => {
              const member = find(assignee.memberId)
              return (
                <li key={assignee.memberId} className="flex items-center gap-3 px-3.5 py-2">
                  <Avatar name={member?.name ?? '?'} className="size-8 text-xs" />
                  <span className="min-w-0 flex-1 truncate text-[15px] font-medium">
                    {member?.name ?? 'Someone'}
                    {member && !member.isActive && <span className="ml-1 font-normal text-muted">(removed)</span>}
                    {scope.me?.id === assignee.memberId && (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-medium text-accent">
                        You
                      </span>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-sm text-muted">
                    <StatusIcon status={assignee.status} className="size-5" />
                    {STATUS_LABELS[assignee.status]}
                  </span>
                  {isAdmin && (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={groupCompleted}
                      title={groupCompleted ? 'Reopen the task first' : undefined}
                      aria-label={`Change ${member?.name ?? 'their'} progress`}
                      onClick={() =>
                        setIntent({
                          kind: 'status',
                          memberId: assignee.memberId,
                          status: assignee.status,
                          pickStatus: true,
                        })
                      }
                    >
                      Change
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <dl className="divide-y divide-line rounded-2xl border border-line px-4 py-4">
        {task.assignees.length > 1 && (
          <Detail label="Who needs to finish">
            {MODE_LABELS[task.assignmentMode]}
            <span className="block text-sm font-normal text-muted">
              {task.assignmentMode === 'all' ? 'Each person finishes their own part' : 'One person can finish it for all'}
            </span>
          </Detail>
        )}
        <Detail label="Due">
          <span className={cn(overdue && 'text-danger')}>{dueLabel(task)}</span>
        </Detail>
        <Detail label="Priority">{PRIORITY_LABELS[task.priority]}</Detail>
        {task.status === 'completed' && task.completedAt && (
          <Detail label="Completed">
            {task.completedBy?.name ?? 'Someone'} · {format(parseISO(task.completedAt), 'MMM d, h:mm a')}
          </Detail>
        )}
      </dl>

      {task.description && (
        <section aria-labelledby="description-heading">
          <SectionTitle id="description-heading">Description</SectionTitle>
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">
            {task.description}
          </p>
        </section>
      )}

      <NoteSection task={task} />

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

      <ProgressDialog task={task} intent={intent} onClose={() => setIntent(null)} />

      {isAdmin ? (
        <PromptDialog
          open={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          title={`Delete “${task.title}”?`}
          description="This removes the task and its history from the Collabo. It can’t be undone."
          confirmLabel="Delete"
          confirmVariant="danger"
          confirmDisabled={deleteReason.trim().length < 3}
          loading={remove.isPending}
          onConfirm={() =>
            remove.mutate(
              { task, reason: deleteReason.trim() },
              {
                onSuccess: () => {
                  toast.success('Task deleted')
                  setConfirmingDelete(false)
                  onClose()
                },
              },
            )
          }
        >
          <TextAreaField
            label="Reason"
            hint="Required. Recorded in the admin audit log."
            rows={2}
            value={deleteReason}
            onChange={(event) => setDeleteReason(event.target.value)}
          />
        </PromptDialog>
      ) : (
        <ConfirmDialog
          open={confirmingDelete}
          onClose={() => setConfirmingDelete(false)}
          title={`Delete “${task.title}”?`}
          description="This will remove the task from the Collabo."
          confirmLabel="Delete"
          loading={remove.isPending}
          onConfirm={() =>
            remove.mutate(
              { task },
              {
                onSuccess: () => {
                  toast.success('Task deleted')
                  setConfirmingDelete(false)
                  onClose()
                },
              },
            )
          }
        />
      )}
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
