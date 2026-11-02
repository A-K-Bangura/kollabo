import { LIMITS } from '@shared/constants'
import type { AdminProjectSummaryDto } from '@shared/types'
import { useQueryClient } from '@tanstack/react-query'
import { Check, Copy, KeyRound, Pause, Pencil, Play, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { PromptDialog } from '@/components/ui/Dialog'
import { InlineAlert } from '@/components/ui/feedback'
import { TextAreaField, TextField } from '@/components/ui/fields'
import { adminApi } from '@/lib/adminApi'
import { copyToClipboard } from '@/lib/clipboard'
import { adminKeys } from './hooks'

type Action = 'rename' | 'suspend' | 'reactivate' | 'delete' | 'restore' | 'rotate'

interface ActionConfig {
  title: (project: AdminProjectSummaryDto) => string
  description: string
  confirmLabel: string
  danger?: boolean
  /** Reasons are always recorded when given; for some actions they are mandatory. */
  reason: 'required' | 'optional'
}

const CONFIG: Record<Exclude<Action, 'rename'>, ActionConfig> = {
  suspend: {
    title: (project) => `Suspend “${project.name}”?`,
    description:
      'Members are locked out immediately: they see a notice instead of their tasks. Nothing is deleted, and reactivating restores everything.',
    confirmLabel: 'Suspend',
    danger: true,
    reason: 'required',
  },
  reactivate: {
    title: (project) => `Reactivate “${project.name}”?`,
    description: 'Members can open it again straight away, with the same code and all their work.',
    confirmLabel: 'Reactivate',
    reason: 'optional',
  },
  delete: {
    title: (project) => `Delete “${project.name}”?`,
    description:
      'It disappears for its members and their code stops working. Nothing is destroyed: you can recover it from this page at any time.',
    confirmLabel: 'Delete',
    danger: true,
    reason: 'required',
  },
  restore: {
    title: (project) => `Recover “${project.name}”?`,
    description: 'It returns to the state it was in before it was deleted, and its members can use their code again.',
    confirmLabel: 'Recover',
    reason: 'optional',
  },
  rotate: {
    title: (project) => `New access code for “${project.name}”?`,
    description:
      'The current code stops working at once and everyone is signed out. You’ll be shown the new code once, so have somewhere to put it.',
    confirmLabel: 'Generate new code',
    danger: true,
    reason: 'required',
  },
}

/** Lifecycle controls for one project. Everything here is recorded in the audit log under the administrator's name. */
export function ProjectActions({ project }: { project: AdminProjectSummaryDto }) {
  const queryClient = useQueryClient()
  const [action, setAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issuedCode, setIssuedCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const open = (next: Action) => {
    setAction(next)
    setReason('')
    setName(project.name)
    setError(null)
  }
  const close = () => setAction(null)

  const config = action && action !== 'rename' ? CONFIG[action] : null
  const reasonText = reason.trim()
  const needsReason = action === 'rename' ? false : config?.reason === 'required'
  const disabled = (needsReason && reasonText.length < 3) || (action === 'rename' && name.trim() === '')

  const store = async (updated: AdminProjectSummaryDto) => {
    queryClient.setQueryData(adminKeys.project(project.id), updated)
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: adminKeys.projects }),
      queryClient.invalidateQueries({ queryKey: adminKeys.overview }),
      queryClient.invalidateQueries({ queryKey: [...adminKeys.audit, project.id] }),
    ])
  }

  const run = async () => {
    if (!action) return
    setBusy(true)
    setError(null)
    try {
      const optional = reasonText || undefined
      switch (action) {
        case 'rename':
          await store(await adminApi.renameProject(project.id, name.trim(), optional))
          toast.success('Renamed')
          break
        case 'suspend':
          await store(await adminApi.suspendProject(project.id, reasonText))
          toast.success('Project suspended')
          break
        case 'reactivate':
          await store(await adminApi.reactivateProject(project.id, optional))
          toast.success('Project reactivated')
          break
        case 'delete':
          await store(await adminApi.deleteProject(project.id, reasonText))
          toast.success('Project deleted. You can recover it from this page.')
          break
        case 'restore':
          await store(await adminApi.restoreProject(project.id, optional))
          toast.success('Project recovered')
          break
        case 'rotate': {
          const result = await adminApi.rotateCode(project.id, reasonText)
          await store(result.project)
          setIssuedCode(result.accessCode)
          setCopied(false)
          break
        }
      }
      close()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!issuedCode) return
    if (await copyToClipboard(issuedCode)) {
      setCopied(true)
      toast.success('Code copied')
    } else {
      toast.error('Couldn’t copy automatically. Select the code and copy it by hand.')
    }
  }

  const deleted = project.status === 'deleted'

  return (
    <section aria-labelledby="actions-heading">
      <h2 id="actions-heading" className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Manage
      </h2>
      <div className="flex flex-wrap gap-2">
        {!deleted && (
          <Button variant="secondary" onClick={() => open('rename')}>
            <Pencil className="size-4" aria-hidden />
            Rename
          </Button>
        )}
        {project.status === 'active' && (
          <Button variant="secondary" onClick={() => open('suspend')}>
            <Pause className="size-4" aria-hidden />
            Suspend
          </Button>
        )}
        {project.status === 'suspended' && (
          <Button variant="secondary" onClick={() => open('reactivate')}>
            <Play className="size-4" aria-hidden />
            Reactivate
          </Button>
        )}
        {!deleted && (
          <Button variant="secondary" onClick={() => open('rotate')}>
            <KeyRound className="size-4" aria-hidden />
            New access code
          </Button>
        )}
        {deleted ? (
          <Button onClick={() => open('restore')}>
            <RotateCcw className="size-4" aria-hidden />
            Recover project
          </Button>
        ) : (
          <Button variant="ghost" className="text-danger hover:text-danger" onClick={() => open('delete')}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </Button>
        )}
      </div>

      <PromptDialog
        open={action !== null}
        onClose={close}
        title={action === 'rename' ? 'Rename project' : config ? config.title(project) : ''}
        description={action === 'rename' ? 'Members see the new name straight away.' : config?.description}
        confirmLabel={action === 'rename' ? 'Save name' : (config?.confirmLabel ?? '')}
        confirmVariant={config?.danger ? 'danger' : 'primary'}
        confirmDisabled={disabled}
        loading={busy}
        onConfirm={() => void run()}
        wide
      >
        {error && <InlineAlert>{error}</InlineAlert>}
        {action === 'rename' && (
          <TextField
            label="Project name"
            autoFocus
            maxLength={LIMITS.projectName + 10}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
        <TextAreaField
          label={needsReason ? 'Reason' : 'Reason (optional)'}
          hint="Recorded in the audit log. Project members don’t see it."
          rows={2}
          maxLength={LIMITS.reason}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        />
      </PromptDialog>

      <PromptDialog
        open={issuedCode !== null}
        onClose={() => setIssuedCode(null)}
        title="New access code"
        description="This is the only time it’s shown. We keep just a scrambled version, so it can’t be looked up again."
        confirmLabel="I’ve saved it"
        cancelLabel={null}
        onConfirm={() => setIssuedCode(null)}
      >
        <p
          data-testid="new-access-code"
          className="select-all rounded-2xl border border-line bg-raised px-4 py-4 text-center font-mono text-2xl font-semibold tracking-[0.12em]"
        >
          {issuedCode}
        </p>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Copied' : 'Copy code'}
        </Button>
        <p className="text-sm text-muted">The old code and every existing session have already stopped working.</p>
      </PromptDialog>
    </section>
  )
}
