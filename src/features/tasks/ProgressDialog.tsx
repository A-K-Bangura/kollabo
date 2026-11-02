import { LIMITS, STATUS_LABELS, TASK_STATUSES, type TaskStatus } from '@shared/constants'
import type { TaskDto } from '@shared/types'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { PromptDialog } from '@/components/ui/Dialog'
import { InlineAlert } from '@/components/ui/feedback'
import { TextAreaField } from '@/components/ui/fields'
import { useProjectScope } from '@/features/scope/scope'
import { useReportError } from '@/features/session/hooks'
import { useMemberLookup } from '@/features/team/hooks'
import { isConflict } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useRefreshAction, useReopenTask, useSetAssigneeStatus } from './hooks'
import { StatusIcon } from './StatusIcon'

export type ProgressIntent =
  /** Change one person's progress. `pickStatus` lets the dialog choose the target (administrators). */
  | { kind: 'status'; memberId: string; status: TaskStatus; pickStatus?: boolean }
  /** Reopen a task that was finished for the whole group. */
  | { kind: 'reopen' }

interface ProgressDialogProps {
  /** Undefined while closed. */
  task: TaskDto | undefined
  intent: ProgressIntent | null
  onClose: () => void
}

/**
 * Every change to progress goes through here, so the optional note and (for administrators)
 * the required reason are asked for in one consistent place. A blank note means "leave the
 * shared note as it is": it never clears anything.
 */
export function ProgressDialog({ task, intent, onClose }: ProgressDialogProps) {
  const scope = useProjectScope()
  const { find } = useMemberLookup()
  const setStatus = useSetAssigneeStatus()
  const reopen = useReopenTask()
  const refresh = useRefreshAction()
  const report = useReportError()

  const [seen, setSeen] = useState(intent)
  const [status, setTargetStatus] = useState<TaskStatus>(intent?.kind === 'status' ? intent.status : 'in_progress')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [conflict, setConflict] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // A fresh dialog each time it is opened: state belongs to one intent.
  if (intent !== seen) {
    setSeen(intent)
    setTargetStatus(intent?.kind === 'status' ? intent.status : 'in_progress')
    setNote('')
    setReason('')
    setConflict(false)
  }

  const isAdmin = scope.viewer === 'admin'
  const subject = intent?.kind === 'status' ? find(intent.memberId) : undefined
  const isSelf = intent?.kind === 'status' && scope.me?.id === intent.memberId
  const groupCompletes =
    intent?.kind === 'status' && task?.assignmentMode === 'any' && status === 'completed'
  const pending = setStatus.isPending || reopen.isPending
  const reasonMissing = isAdmin && reason.trim().length < 3
  const trimmedNote = note.trim()

  let title = ''
  let description = ''
  let confirmLabel = ''
  if (intent?.kind === 'reopen') {
    title = 'Reopen this task?'
    description =
      'It goes back to In Progress for everyone. Whoever finished it returns to In Progress too, and the history keeps a record of both.'
    confirmLabel = 'Reopen task'
  } else if (intent?.kind === 'status') {
    title = isSelf ? 'Update your progress' : `Change ${subject?.name ?? 'their'}${subject ? '’s' : ''} progress`
    description = groupCompletes
      ? 'This marks the task Done for everyone. The others’ own progress stays exactly as it is, and only reopening the task changes that.'
      : task && task.assignmentMode === 'all' && task.assignees.length > 1
        ? status === 'completed'
          ? 'Your part will be marked done. The task is done once everyone’s part is.'
          : `This moves ${isSelf ? 'your part' : 'their part'} to ${STATUS_LABELS[status]}.`
        : `This moves the task to ${STATUS_LABELS[status]}.`
    confirmLabel = groupCompletes ? 'Mark done for everyone' : `Move to ${STATUS_LABELS[status]}`
  }

  const onConfirm = () => {
    if (!intent || !task) return
    const done = () => {
      toast.success(intent.kind === 'reopen' ? 'Task reopened' : 'Progress updated')
      onClose()
    }
    const failed = (error: Error) => {
      if (isConflict(error)) setConflict(true)
      else report(error)
    }
    const extras = {
      ...(trimmedNote ? { note: trimmedNote } : {}),
      ...(isAdmin ? { reason: reason.trim() } : {}),
    }
    if (intent.kind === 'reopen') {
      reopen.mutate({ task, ...extras }, { onSuccess: done, onError: failed })
    } else {
      setStatus.mutate({ task, memberId: intent.memberId, status, ...extras }, { onSuccess: done, onError: failed })
    }
  }

  const refreshNow = async () => {
    setRefreshing(true)
    try {
      await refresh()
      setConflict(false)
    } catch (error) {
      report(error)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <PromptDialog
      open={intent !== null && task !== undefined}
      onClose={onClose}
      title={title}
      description={description}
      confirmLabel={confirmLabel}
      confirmDisabled={reasonMissing || conflict}
      loading={pending}
      onConfirm={onConfirm}
      wide
    >
      {conflict && (
        <InlineAlert
          tone="warn"
          action={
            <Button size="sm" variant="secondary" onClick={() => void refreshNow()} loading={refreshing}>
              Refresh
            </Button>
          }
        >
          This changed since you last refreshed. Refresh to see the latest, then try again.
        </InlineAlert>
      )}

      {intent?.kind === 'status' && intent.pickStatus && (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-sm font-medium">New status</legend>
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-raised p-1">
            {TASK_STATUSES.map((option) => (
              <label key={option} className="relative">
                <input
                  type="radio"
                  name="progress-status"
                  value={option}
                  checked={status === option}
                  onChange={() => setTargetStatus(option)}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'flex h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-muted transition sm:text-sm',
                    'peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-sm',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                  )}
                >
                  <StatusIcon status={option} className="size-5" />
                  <span className="truncate">{STATUS_LABELS[option]}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      {task?.progressNote && (
        <div className="rounded-xl bg-raised px-3.5 py-3 text-sm">
          <p className="mb-1 font-medium">Current note</p>
          <p className="line-clamp-3 whitespace-pre-wrap text-muted [overflow-wrap:anywhere]">{task.progressNote}</p>
        </div>
      )}

      <TextAreaField
        label="Progress note (optional)"
        hint={
          task?.progressNote
            ? 'Leave blank to keep the current note. Anything you write replaces it for everyone, and the earlier version stays in the history.'
            : 'Shared with everyone on the task. Leave blank to skip.'
        }
        rows={3}
        maxLength={LIMITS.progressNote}
        value={note}
        onChange={(event) => setNote(event.target.value)}
      />

      {isAdmin && (
        <TextAreaField
          label="Reason"
          hint="Required. Recorded in the admin audit log; project members don’t see it."
          rows={2}
          maxLength={LIMITS.reason}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      )}
    </PromptDialog>
  )
}
