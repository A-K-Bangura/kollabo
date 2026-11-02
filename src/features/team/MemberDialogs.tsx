import { personNameSchema } from '@shared/schemas'
import type { MemberDto } from '@shared/types'
import { useState } from 'react'
import { PromptDialog } from '@/components/ui/Dialog'
import { InlineAlert } from '@/components/ui/feedback'
import { SelectField, TextField } from '@/components/ui/fields'
import { useReportError } from '@/features/session/hooks'
import { ApiClientError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useDeactivateMember, useMemberLookup, useRenameMember } from './hooks'

interface RenameDialogProps {
  member: MemberDto | null
  onClose: () => void
}

/** Renaming changes the name everywhere, including on old tasks and history entries that read live from the team. */
export function RenameDialog({ member, onClose }: RenameDialogProps) {
  const rename = useRenameMember()
  const [seen, setSeen] = useState(member)
  const [name, setName] = useState(member?.name ?? '')
  const [error, setError] = useState<string | undefined>()

  if (member !== seen) {
    setSeen(member)
    setName(member?.name ?? '')
    setError(undefined)
  }

  const submit = () => {
    if (!member) return
    const parsed = personNameSchema.safeParse(name)
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message)
      return
    }
    if (parsed.data === member.name) {
      onClose()
      return
    }
    rename.mutate(
      { member, name: parsed.data },
      {
        onSuccess: onClose,
        onError: (failure) => setError(failure.message),
      },
    )
  }

  return (
    <PromptDialog
      open={member !== null}
      onClose={onClose}
      title="Rename"
      description="Their old name is replaced everywhere, including on past tasks and activity."
      confirmLabel="Save name"
      loading={rename.isPending}
      onConfirm={submit}
    >
      <TextField
        label="Name"
        autoFocus
        autoComplete="off"
        value={name}
        onChange={(event) => {
          setName(event.target.value)
          setError(undefined)
        }}
        error={error}
      />
    </PromptDialog>
  )
}

interface OpenTasksDetails {
  total: number
  tasks: { id: string; title: string; onlyAssignee: boolean }[]
}

function readOpenTasks(error: unknown): OpenTasksDetails | null {
  if (!(error instanceof ApiClientError) || error.code !== 'MEMBER_HAS_OPEN_TASKS') return null
  const details = error.details as Partial<OpenTasksDetails> | undefined
  return { total: details?.total ?? 0, tasks: details?.tasks ?? [] }
}

type Choice = 'handover' | 'release'

interface RemoveDialogProps {
  member: MemberDto | null
  onClose: () => void
  /** Called after the person has been removed (e.g. to sign yourself out of the "who" choice). */
  onRemoved?: (member: MemberDto) => void
}

/**
 * Removing someone never strands work. If they have no unfinished tasks it just happens;
 * if they do, the dialog shows what is at stake and asks what should happen to it: hand
 * it to a teammate, or (where others are already on it) just take them off. Nothing is
 * changed until a choice is made, and it all happens in one step on the server.
 */
export function RemoveDialog({ member, onClose, onRemoved }: RemoveDialogProps) {
  const deactivate = useDeactivateMember()
  const report = useReportError()
  const { activeMembers } = useMemberLookup()
  const [seen, setSeen] = useState(member)
  const [open, setOpen] = useState<OpenTasksDetails | null>(null)
  const [choice, setChoice] = useState<Choice>('handover')
  const [target, setTarget] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  if (member !== seen) {
    setSeen(member)
    setOpen(null)
    setChoice('handover')
    setTarget('')
    setProblem(null)
  }

  const others = activeMembers.filter((candidate) => candidate.id !== member?.id)
  const soleCount = open?.tasks.filter((task) => task.onlyAssignee).length ?? 0
  const canRelease = open !== null && soleCount === 0

  const submit = () => {
    if (!member) return
    setProblem(null)
    const input =
      open === null
        ? {}
        : choice === 'handover'
          ? { reassignToMemberId: target }
          : { reassignToMemberId: null }

    deactivate.mutate(
      { member, ...input },
      {
        onSuccess: () => {
          onClose()
          onRemoved?.(member)
        },
        onError: (error) => {
          const details = readOpenTasks(error)
          if (!details) {
            report(error)
            return
          }
          // A second refusal means "take them off" was chosen but some task has nobody else on it.
          if (open !== null) {
            setProblem('Some of these tasks have nobody else on them, so they need to be handed to someone.')
          }
          setOpen(details)
          if (open !== null || details.tasks.some((task) => task.onlyAssignee)) setChoice('handover')
        },
      },
    )
  }

  const resolving = open !== null

  return (
    <PromptDialog
      open={member !== null}
      onClose={onClose}
      wide={resolving}
      title={
        !member
          ? ''
          : resolving
            ? `${member.name} still has unfinished work`
            : `Remove ${member.name}?`
      }
      description={
        resolving
          ? `${open.total} unfinished ${open.total === 1 ? 'task' : 'tasks'}. Decide what happens to ${open.total === 1 ? 'it' : 'them'} before they’re removed.`
          : 'Their tasks and history stay exactly as they are. They just won’t be offered for new work.'
      }
      confirmLabel={resolving ? (choice === 'handover' ? 'Hand over and remove' : 'Take off tasks and remove') : 'Remove'}
      confirmVariant="danger"
      confirmDisabled={resolving && choice === 'handover' && target === ''}
      loading={deactivate.isPending}
      onConfirm={submit}
    >
      {problem && <InlineAlert>{problem}</InlineAlert>}

      {resolving && (
        <>
          <ul
            aria-label="Their unfinished tasks"
            className="max-h-40 divide-y divide-line overflow-y-auto rounded-xl border border-line"
          >
            {open.tasks.map((task) => (
              <li key={task.id} className="flex items-center justify-between gap-3 px-3 py-2 text-[15px]">
                <span className="min-w-0 truncate">{task.title}</span>
                {task.onlyAssignee && (
                  <span className="shrink-0 rounded-full bg-warn-soft px-2 py-0.5 text-xs font-medium text-warn">
                    only person on it
                  </span>
                )}
              </li>
            ))}
            {open.total > open.tasks.length && (
              <li className="px-3 py-2 text-sm text-muted">and {open.total - open.tasks.length} more</li>
            )}
          </ul>

          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">What should happen to them?</legend>
            {(
              [
                { value: 'handover' as const, label: 'Hand them to a teammate', disabled: false },
                {
                  value: 'release' as const,
                  label: 'Just take them off these tasks',
                  disabled: !canRelease,
                  hint: canRelease ? undefined : 'Not possible: some tasks have nobody else on them.',
                },
              ] as const
            ).map((option) => (
              <label
                key={option.value}
                className={cn(
                  'flex cursor-pointer items-start gap-3 rounded-xl border border-line px-3.5 py-3 transition',
                  choice === option.value && 'border-accent bg-accent-soft/50',
                  option.disabled && 'cursor-not-allowed opacity-60',
                )}
              >
                <input
                  type="radio"
                  name="removal-choice"
                  value={option.value}
                  checked={choice === option.value}
                  disabled={option.disabled}
                  onChange={() => setChoice(option.value)}
                  className="mt-1 accent-[var(--accent)]"
                />
                <span className="text-[15px]">
                  {option.label}
                  {'hint' in option && option.hint && (
                    <span className="block text-sm text-muted">{option.hint}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>

          {choice === 'handover' && (
            <SelectField label="Hand over to" value={target} onChange={(event) => setTarget(event.target.value)}>
              <option value="">Choose someone…</option>
              {others.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </SelectField>
          )}
        </>
      )}
    </PromptDialog>
  )
}
