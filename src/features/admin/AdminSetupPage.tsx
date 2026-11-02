import { Check, Copy, KeyRound, Smartphone } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { InlineAlert } from '@/components/ui/feedback'
import { TextField } from '@/components/ui/fields'
import { useQueryClient } from '@tanstack/react-query'
import { adminApi } from '@/lib/adminApi'
import { copyToClipboard } from '@/lib/clipboard'
import { adminKeys, isSetupComplete, useAdminQuery } from './hooks'
import { QrCode } from './QrCode'

function ChoosePassword({ onDone }: { onDone: () => void }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [again, setAgain] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const mismatch = again !== '' && again !== next
  const tooShort = next !== '' && next.length < 12

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (next.length < 12 || next !== again) return
    setBusy(true)
    setError(null)
    try {
      await adminApi.changePassword(current, next)
      toast.success('Password changed')
      onDone()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t change the password.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <KeyRound className="size-5 text-accent" aria-hidden />
          Choose your own password
        </h2>
        <p className="mt-1 text-[15px] text-muted">
          You signed in with a one-time password. Replace it with one only you know. Use at least 12
          characters; a few random words works well.
        </p>
      </div>
      <TextField
        label="Current (one-time) password"
        type="password"
        autoComplete="current-password"
        value={current}
        onChange={(event) => setCurrent(event.target.value)}
      />
      <TextField
        label="New password"
        type="password"
        autoComplete="new-password"
        value={next}
        onChange={(event) => setNext(event.target.value)}
        error={tooShort ? 'Use at least 12 characters' : undefined}
      />
      <TextField
        label="Repeat new password"
        type="password"
        autoComplete="new-password"
        value={again}
        onChange={(event) => setAgain(event.target.value)}
        error={mismatch ? 'Those don’t match' : undefined}
      />
      {error && <InlineAlert>{error}</InlineAlert>}
      <Button type="submit" size="lg" loading={busy} disabled={!current || next.length < 12 || next !== again}>
        Save password
      </Button>
    </form>
  )
}

function formatSecret(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get('secret') ?? ''
  return secret.replace(/(.{4})/g, '$1 ').trim()
}

function EnrollTwoFactor({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('')
  const [started, setStarted] = useState<{ totpURI: string; backupCodes: string[] } | null>(null)
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      setStarted(await adminApi.startTwoFactor(password))
      setPassword('')
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t start setup.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await adminApi.verifyCode(code)
      toast.success('Two-factor authentication is on')
      onDone()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That code didn’t work.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  if (!started) {
    return (
      <form onSubmit={start} noValidate className="flex flex-col gap-4">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <Smartphone className="size-5 text-accent" aria-hidden />
            Set up two-factor authentication
          </h2>
          <p className="mt-1 text-[15px] text-muted">
            Administrators must use an authenticator app (such as Google Authenticator, 1Password or
            Authy) as well as a password. Confirm your password to begin.
          </p>
        </div>
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
        {error && <InlineAlert>{error}</InlineAlert>}
        <Button type="submit" size="lg" loading={busy} disabled={!password}>
          Continue
        </Button>
      </form>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="scan-heading" className="flex flex-col items-center gap-3 text-center">
        <h2 id="scan-heading" className="text-lg font-semibold">
          1. Scan this with your authenticator app
        </h2>
        <QrCode value={started.totpURI} label="QR code for your authenticator app" />
        <details className="text-sm text-muted">
          <summary className="cursor-pointer font-medium text-accent">Can’t scan? Enter the key by hand</summary>
          <p className="mt-2 select-all break-all font-mono text-ink" data-testid="manual-key">
            {formatSecret(started.totpURI)}
          </p>
        </details>
      </section>

      <section aria-labelledby="backup-heading" className="flex flex-col gap-3">
        <h2 id="backup-heading" className="text-lg font-semibold">
          2. Keep these backup codes somewhere safe
        </h2>
        <p className="text-[15px] text-muted">
          If you lose your phone, each code lets you in once. They’re shown only now.
        </p>
        <ul
          aria-label="Backup codes"
          data-testid="backup-codes"
          className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3 font-mono text-sm"
        >
          {started.backupCodes.map((backup) => (
            <li key={backup} className="select-all">
              {backup}
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              void copyToClipboard(started.backupCodes.join('\n')).then((ok) =>
                ok ? toast.success('Backup codes copied') : toast.error('Couldn’t copy. Select them by hand.'),
              )
            }
          >
            <Copy className="size-4" aria-hidden />
            Copy codes
          </Button>
          <label className="flex items-center gap-2 text-[15px]">
            <input
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
              className="size-5 accent-[var(--accent)]"
            />
            I’ve saved them
          </label>
        </div>
      </section>

      <form onSubmit={confirm} noValidate className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">3. Enter the 6-digit code to finish</h2>
        <TextField
          label="6-digit code"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={7}
          value={code}
          onChange={(event) => setCode(event.target.value)}
          className="[&_input]:text-center [&_input]:font-mono [&_input]:tracking-[0.3em]"
        />
        {error && <InlineAlert>{error}</InlineAlert>}
        <Button type="submit" size="lg" loading={busy} disabled={!saved || code.replace(/\s/g, '').length < 6}>
          <Check className="size-4" aria-hidden />
          Turn on two-factor
        </Button>
        {!saved && <p className="text-center text-sm text-muted">Tick “I’ve saved them” first.</p>}
      </form>
    </div>
  )
}

/** Finishing account setup: a personal password if it was handed over, then two-factor. */
export function AdminSetupPage() {
  const me = useAdminQuery()
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  if (!me.data) return null
  if (isSetupComplete(me.data)) return <Navigate to="/admin" replace />

  // After the password step the same screen moves on to two-factor by itself.
  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeys.me })
  const done = async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.me })
    void navigate('/admin', { replace: true })
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-6 py-10">
      <p className="text-sm text-muted">Signed in as {me.data.email}</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Finish setting up your account</h1>
      <p className="mt-1 mb-8 text-[15px] text-muted">
        {me.data.mustChangePassword ? 'Two quick steps before you can use the admin area.' : 'One quick step before you can use the admin area.'}
      </p>
      {me.data.mustChangePassword ? (
        <ChoosePassword onDone={() => void refresh()} />
      ) : (
        <EnrollTwoFactor onDone={() => void done()} />
      )}
    </main>
  )
}
