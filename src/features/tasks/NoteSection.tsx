import { LIMITS } from '@shared/constants'
import type { NoteRevisionDto, TaskDto } from '@shared/types'
import { Eraser, History, Pencil } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { InlineAlert, Skeleton } from '@/components/ui/feedback'
import { TextAreaField } from '@/components/ui/fields'
import { useProjectScope } from '@/features/scope/scope'
import { useReportError } from '@/features/session/hooks'
import { isConflict } from '@/lib/api'
import { formatActivityTime } from '@/lib/dates'
import { useClearNote, useEditNote, useNoteRevisionsQuery, useRefreshAction } from './hooks'
import { isAssigned } from './lib'

function Revisions({ task }: { task: TaskDto }) {
  const revisions = useNoteRevisionsQuery(task.id, true)

  if (revisions.isPending) {
    return (
      <div role="status" aria-label="Loading note history" className="space-y-2">
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    )
  }
  if (revisions.isError) {
    return (
      <p role="alert" className="text-sm text-muted">
        Couldn’t load the history.{' '}
        <Button variant="ghost" size="sm" onClick={() => void revisions.refetch()}>
          Try again
        </Button>
      </p>
    )
  }

  // Newest first: the question people ask is "what did it say before?".
  const ordered: NoteRevisionDto[] = [...revisions.data].sort((a, b) => b.revisionNumber - a.revisionNumber)
  return (
    <ol aria-label="Earlier versions of the note" className="space-y-3">
      {ordered.map((revision, index) => (
        <li key={revision.id} className="rounded-xl border border-line px-3.5 py-3">
          <p className="text-xs text-muted">
            {index === 0 ? 'Current · ' : ''}
            Version {revision.revisionNumber} · {revision.editor.name}
            {revision.editor.type === 'admin' && ' (admin)'} · {formatActivityTime(revision.createdAt)}
          </p>
          {revision.isClear ? (
            <p className="mt-1 text-[15px] italic text-muted">Note cleared</p>
          ) : (
            <p className="mt-1 whitespace-pre-wrap text-[15px] [overflow-wrap:anywhere]">{revision.content}</p>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * The task's one shared progress note. Anyone assigned (or an administrator) can edit it;
 * editing never overwrites silently, because every change is a new version and the old
 * ones stay readable. Clearing is its own deliberate action.
 */
export function NoteSection({ task }: { task: TaskDto }) {
  const scope = useProjectScope()
  const edit = useEditNote()
  const clear = useClearNote()
  const refresh = useRefreshAction()
  const report = useReportError()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [reason, setReason] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const isAdmin = scope.viewer === 'admin'
  const canEdit = isAdmin || isAssigned(task, scope.me?.id ?? null)
  const hasNote = task.progressNote !== null
  const trimmed = draft.trim()

  const startEditing = () => {
    setDraft(task.progressNote ?? '')
    setReason('')
    setConflict(false)
    setEditing(true)
  }

  const onError = (error: Error) => {
    if (isConflict(error)) setConflict(true)
    else report(error)
  }

  const save = () => {
    if (!trimmed) return
    if (trimmed === (task.progressNote ?? '')) {
      setEditing(false)
      return
    }
    edit.mutate(
      { task, content: trimmed, ...(isAdmin && reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success('Note saved')
          setEditing(false)
        },
        onError,
      },
    )
  }

  const confirmClear = () =>
    clear.mutate(
      { task, ...(isAdmin && reason.trim() ? { reason: reason.trim() } : {}) },
      {
        onSuccess: () => {
          toast.success('Note cleared')
          setConfirmingClear(false)
        },
        onError: (error) => {
          setConfirmingClear(false)
          onError(error)
        },
      },
    )

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
    <section aria-labelledby="note-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 id="note-heading" className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
          Progress note
        </h3>
        {canEdit && !editing && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={startEditing}>
              <Pencil className="size-4" aria-hidden />
              {hasNote ? 'Edit' : 'Add note'}
            </Button>
            {hasNote && (
              <Button size="sm" variant="ghost" onClick={() => setConfirmingClear(true)}>
                <Eraser className="size-4" aria-hidden />
                Clear
              </Button>
            )}
          </div>
        )}
      </div>

      {conflict && (
        <InlineAlert
          tone="warn"
          action={
            <Button size="sm" variant="secondary" onClick={() => void refreshNow()} loading={refreshing}>
              Refresh
            </Button>
          }
        >
          Someone updated the note since you last refreshed. Refresh to see their version, then redo your change.
          {editing ? ' What you typed is kept.' : ''}
        </InlineAlert>
      )}

      {editing ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
          className="flex flex-col gap-3"
        >
          <TextAreaField
            label="Note for everyone on this task"
            hint={`${trimmed.length}/${LIMITS.progressNote} · Plain text. Earlier versions stay in the history.`}
            rows={5}
            autoFocus
            maxLength={LIMITS.progressNote}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          {isAdmin && (
            <TextAreaField
              label="Reason (optional)"
              hint="Recorded in the admin audit log."
              rows={2}
              maxLength={LIMITS.reason}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setEditing(false)} disabled={edit.isPending}>
              Cancel
            </Button>
            <Button type="submit" loading={edit.isPending} disabled={!trimmed}>
              Save note
            </Button>
          </div>
        </form>
      ) : hasNote ? (
        <div className="rounded-2xl border border-line px-4 py-3.5">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed [overflow-wrap:anywhere]">
            {task.progressNote}
          </p>
          {task.noteUpdatedBy && task.noteUpdatedAt && (
            <p className="mt-2 text-sm text-muted">
              {task.noteUpdatedBy.name}
              {task.noteUpdatedBy.type === 'admin' && ' (admin)'} · {formatActivityTime(task.noteUpdatedAt)}
            </p>
          )}
        </div>
      ) : (
        <p className="text-[15px] text-muted">
          {task.progressNoteVersion > 0
            ? 'The note was cleared. Earlier versions are in the history.'
            : canEdit
              ? 'No note yet. Add one to tell the team where things stand.'
              : 'No note yet. People assigned to this task can add one.'}
        </p>
      )}

      {task.progressNoteVersion > 0 && (
        <div>
          <Button
            size="sm"
            variant="ghost"
            aria-expanded={showHistory}
            onClick={() => setShowHistory((open) => !open)}
          >
            <History className="size-4" aria-hidden />
            {showHistory ? 'Hide history' : `History · ${task.progressNoteVersion} ${task.progressNoteVersion === 1 ? 'version' : 'versions'}`}
          </Button>
          {showHistory && (
            <div className="mt-2">
              <Revisions task={task} />
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmingClear}
        onClose={() => setConfirmingClear(false)}
        title="Clear the progress note?"
        description="The note is removed for everyone on this task. It’s not lost: the earlier version stays in the history."
        confirmLabel="Clear note"
        loading={clear.isPending}
        onConfirm={confirmClear}
      />
    </section>
  )
}
