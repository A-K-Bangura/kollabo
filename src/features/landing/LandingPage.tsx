import { CODE_EXAMPLE, formatAccessCodeInput, normalizeAccessCode } from '@shared/access-code'
import { Plus } from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import { Button } from '@/components/ui/Button'
import { buttonStyles } from '@/components/ui/buttonStyles'
import { FullScreenLoading } from '@/components/ui/feedback'
import { LogoMark } from '@/components/ui/Logo'
import { useEnterCode, useProjectQuery } from '@/features/session/hooks'

/** The front door: enter a code, or start a new Collabo. Nothing else. */
export function LandingPage() {
  const project = useProjectQuery()
  const enter = useEnterCode()
  const navigate = useNavigate()
  const [code, setCode] = useState('')
  const [formatError, setFormatError] = useState<string | null>(null)
  const inputId = useId()
  const errorId = useId()

  // Already inside a Collabo on this browser: carry straight on.
  if (project.isSuccess) return <Navigate to="/today" replace />
  if (project.isPending) return <FullScreenLoading />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = normalizeAccessCode(code)
    if (!normalized) {
      setFormatError(`Enter a code like ${CODE_EXAMPLE}`)
      return
    }
    setFormatError(null)
    enter.mutate(normalized, { onSuccess: () => void navigate('/today') })
  }

  const error = formatError ?? enter.error?.message ?? null

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-10 flex flex-col items-center text-center">
          <LogoMark className="mb-4 size-12" />
          <h1 className="text-3xl font-semibold uppercase tracking-[0.28em]">Collabo</h1>
          <p className="mt-2 text-lg text-muted">Simple tasks. Together.</p>
        </div>

        <form onSubmit={submit} noValidate className="flex flex-col gap-3">
          <label htmlFor={inputId} className="sr-only">
            Project code
          </label>
          <input
            id={inputId}
            value={code}
            onChange={(event) => {
              setCode(formatAccessCodeInput(event.target.value))
              setFormatError(null)
              if (enter.isError) enter.reset()
            }}
            placeholder="Enter project code"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="h-14 w-full rounded-2xl border border-line bg-surface px-4 text-center font-mono text-lg tracking-[0.15em] transition placeholder:font-sans placeholder:tracking-normal hover:border-muted/50 aria-[invalid=true]:border-danger"
          />
          {error && (
            <p id={errorId} role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          )}
          <Button type="submit" size="lg" loading={enter.isPending} className="w-full">
            Enter Collabo
          </Button>
        </form>

        <div className="my-6 flex items-center gap-3 text-sm text-muted" aria-hidden>
          <span className="h-px flex-1 bg-line" />
          or
          <span className="h-px flex-1 bg-line" />
        </div>

        <Link to="/new" className={buttonStyles('secondary', 'lg', 'w-full')}>
          <Plus className="size-5" aria-hidden />
          Create a Collabo
        </Link>
      </div>
    </main>
  )
}
