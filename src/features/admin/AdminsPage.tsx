import type { AdminAccountDto } from '@shared/types'
import { personNameSchema, adminEmailSchema } from '@shared/schemas'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Copy, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { PromptDialog } from '@/components/ui/Dialog'
import { ErrorState, InlineAlert, Skeleton } from '@/components/ui/feedback'
import { TextField } from '@/components/ui/fields'
import { adminApi } from '@/lib/adminApi'
import { copyToClipboard } from '@/lib/clipboard'
import { adminKeys, useAdminQuery } from './hooks'

function AddAdminDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<{ admin: AdminAccountDto; password: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const nameCheck = personNameSchema.safeParse(name)
  const emailCheck = adminEmailSchema.safeParse(email)

  const submit = async () => {
    if (!nameCheck.success || !emailCheck.success) return
    setBusy(true)
    setError(null)
    try {
      const result = await adminApi.createAdmin(nameCheck.data, emailCheck.data)
      await queryClient.invalidateQueries({ queryKey: adminKeys.admins })
      setIssued({ admin: result.admin, password: result.temporaryPassword })
      setName('')
      setEmail('')
      onClose()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t add the administrator.')
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!issued) return
    if (await copyToClipboard(issued.password)) {
      setCopied(true)
      toast.success('Password copied')
    } else {
      toast.error('Couldn’t copy automatically. Select it and copy it by hand.')
    }
  }

  return (
    <>
      <PromptDialog
        open={open}
        onClose={onClose}
        title="Add an administrator"
        description="They’ll get a one-time password to sign in with, and must choose their own and set up an authenticator app before doing anything."
        confirmLabel="Add administrator"
        confirmDisabled={!nameCheck.success || !emailCheck.success}
        loading={busy}
        onConfirm={() => void submit()}
      >
        {error && <InlineAlert>{error}</InlineAlert>}
        <TextField label="Name" autoFocus autoComplete="off" value={name} onChange={(event) => setName(event.target.value)} />
        <TextField
          label="Email"
          type="email"
          autoComplete="off"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={email !== '' && !emailCheck.success ? 'Enter a valid email address' : undefined}
        />
      </PromptDialog>

      <PromptDialog
        open={issued !== null}
        onClose={() => setIssued(null)}
        title={issued ? `${issued.admin.name} can now sign in` : ''}
        description="Give them this one-time password through a private channel. It’s shown only now, and it stops working once they choose their own."
        confirmLabel="I’ve passed it on"
        cancelLabel={null}
        onConfirm={() => setIssued(null)}
      >
        <p
          data-testid="temporary-password"
          className="select-all break-all rounded-2xl border border-line bg-raised px-4 py-4 text-center font-mono text-lg font-semibold"
        >
          {issued?.password}
        </p>
        <Button variant="secondary" onClick={() => void copy()}>
          {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
          {copied ? 'Copied' : 'Copy password'}
        </Button>
      </PromptDialog>
    </>
  )
}

/** Platform administrators. There is no public sign-up: this list and the setup command are the only ways in. */
export function AdminsPage() {
  const me = useAdminQuery()
  const queryClient = useQueryClient()
  const admins = useQuery({ queryKey: adminKeys.admins, queryFn: adminApi.listAdmins })
  const [adding, setAdding] = useState(false)
  const [target, setTarget] = useState<{ admin: AdminAccountDto; activate: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirm = async () => {
    if (!target) return
    setBusy(true)
    setError(null)
    try {
      await (target.activate
        ? adminApi.reactivateAdmin(target.admin.id)
        : adminApi.deactivateAdmin(target.admin.id))
      await queryClient.invalidateQueries({ queryKey: adminKeys.admins })
      toast.success(target.activate ? 'Administrator reactivated' : 'Administrator deactivated')
      setTarget(null)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader title="Administrators" subtitle="People who can manage every Collabo on this platform.">
        <div>
          <Button onClick={() => setAdding(true)}>
            <UserPlus className="size-4" aria-hidden />
            Add administrator
          </Button>
        </div>
      </PageHeader>

      {admins.isPending && <Skeleton className="h-32" />}
      {admins.isError && <ErrorState message={admins.error.message} onRetry={() => void admins.refetch()} />}
      {admins.data && (
        <ul aria-label="Administrators" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {admins.data.map((admin) => {
            const isMe = admin.id === me.data?.id
            return (
              <li key={admin.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={admin.name} className={admin.status === 'deactivated' ? 'opacity-50' : undefined} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-medium">
                    {admin.name}
                    {isMe && (
                      <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-medium text-accent">
                        You
                      </span>
                    )}
                  </p>
                  <p className="truncate text-sm text-muted" title={admin.email}>
                    {admin.email}
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {admin.status === 'deactivated'
                      ? 'Deactivated'
                      : admin.mustChangePassword
                        ? 'Hasn’t chosen a password yet'
                        : admin.twoFactorEnabled
                          ? 'Two-factor on'
                          : 'Two-factor not set up yet'}
                  </p>
                </div>
                {!isMe &&
                  (admin.status === 'active' ? (
                    <Button size="sm" variant="secondary" onClick={() => setTarget({ admin, activate: false })}>
                      Deactivate
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" onClick={() => setTarget({ admin, activate: true })}>
                      Reactivate
                    </Button>
                  ))}
              </li>
            )
          })}
        </ul>
      )}

      <AddAdminDialog open={adding} onClose={() => setAdding(false)} />

      <PromptDialog
        open={target !== null}
        onClose={() => setTarget(null)}
        title={target ? `${target.activate ? 'Reactivate' : 'Deactivate'} ${target.admin.name}?` : ''}
        description={
          target?.activate
            ? 'They can sign in again with their existing password and authenticator.'
            : 'They’re signed out everywhere immediately and can’t sign in again until reactivated.'
        }
        confirmLabel={target?.activate ? 'Reactivate' : 'Deactivate'}
        confirmVariant={target?.activate ? 'primary' : 'danger'}
        loading={busy}
        onConfirm={() => void confirm()}
      >
        {error && <InlineAlert>{error}</InlineAlert>}
      </PromptDialog>
    </>
  )
}
