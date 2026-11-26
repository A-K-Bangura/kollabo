import { ShieldCheck } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { InlineAlert, FullScreenLoading } from '@/components/ui/feedback'
import { TextField } from '@/components/ui/fields'
import { useQueryClient } from '@tanstack/react-query'
import { ApiClientError } from '@/lib/api'
import { adminApi } from '@/lib/adminApi'
import { adminKeys, useAdminQuery } from './hooks'

type Step = 'password' | 'code'

/**
 * Where platform administrators sign in. It is deliberately plain and separate from the
 * project-code front door: administrators are real accounts (email, password, authenticator
 * app), created by whoever runs the deployment, never by signing up here.
 */
export function AdminLoginPage() {
  const me = useAdminQuery()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useBackup, setUseBackup] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (me.isPending) return <FullScreenLoading />
  if (me.isSuccess) return <Navigate to="/admin" replace />
  const notConfigured =
    me.error instanceof ApiClientError && me.error.code === 'ADMIN_NOT_CONFIGURED'

  const finish = async () => {
    await queryClient.invalidateQueries({ queryKey: adminKeys.me })
    void navigate('/admin', { replace: true })
  }

  const submitPassword = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await adminApi.signIn(email.trim(), password)
      setPassword('')
      if (result.twoFactorRequired) setStep('code')
      else await finish() // not enrolled yet: the setup screen takes it from here
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t sign in.')
    } finally {
      setBusy(false)
    }
  }

  const submitCode = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await (useBackup ? adminApi.verifyBackupCode(code) : adminApi.verifyCode(code))
      await finish()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Couldn’t verify that code.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent">
            <ShieldCheck className="size-6" aria-hidden />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Collabo administration</h1>
          <p className="mt-1 text-[15px] text-muted">For platform administrators only.</p>
        </div>

        {notConfigured ? (
          <InlineAlert tone="warn">
            Administration isn’t set up on this deployment yet. Whoever runs Collabo needs to set the
            ADMIN_AUTH_SECRET setting and create the first administrator.
          </InlineAlert>
        ) : step === 'password' ? (
          <form onSubmit={submitPassword} noValidate className="flex flex-col gap-4">
            <TextField
              label="Email"
              type="email"
              autoComplete="username"
              autoFocus
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
            <TextField
              label="Password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {error && <InlineAlert>{error}</InlineAlert>}
            <Button type="submit" size="lg" loading={busy} disabled={!email || !password}>
              Continue
            </Button>
          </form>
        ) : (
          <form onSubmit={submitCode} noValidate className="flex flex-col gap-4">
            <p className="text-[15px] text-muted">
              {useBackup
                ? 'Enter one of your backup codes. Each works once.'
                : 'Open your authenticator app and enter the 6-digit code for Collabo.'}
            </p>
            <TextField
              label={useBackup ? 'Backup code' : '6-digit code'}
              inputMode={useBackup ? 'text' : 'numeric'}
              autoComplete="one-time-code"
              autoFocus
              spellCheck={false}
              maxLength={useBackup ? 24 : 7}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="[&_input]:text-center [&_input]:font-mono [&_input]:tracking-[0.3em]"
            />
            {error && <InlineAlert>{error}</InlineAlert>}
            <Button type="submit" size="lg" loading={busy} disabled={code.trim().length < 4}>
              Sign in
            </Button>
            <div className="flex justify-between text-sm">
              <button
                type="button"
                className="font-medium text-accent underline-offset-2 hover:underline"
                onClick={() => {
                  setUseBackup((value) => !value)
                  setCode('')
                  setError(null)
                }}
              >
                {useBackup ? 'Use my authenticator app' : 'Use a backup code'}
              </button>
              <button
                type="button"
                className="text-muted underline-offset-2 hover:underline"
                onClick={() => {
                  setStep('password')
                  setCode('')
                  setError(null)
                }}
              >
                Start over
              </button>
            </div>
          </form>
        )}

        <p className="mt-10 text-center text-sm text-muted">
          Looking for your team?{' '}
          <Link to="/" className="font-medium text-accent underline-offset-2 hover:underline">
            Enter your project code
          </Link>
        </p>
      </div>
    </main>
  )
}
