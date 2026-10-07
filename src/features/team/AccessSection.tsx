import { Check, Copy, KeyRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { useSessionState } from '@/features/session/sessionState'
import { copyToClipboard } from '@/lib/clipboard'
import { useRegenerateCode } from './hooks'

const MASKED_CODE = '••••-••••-••••'

/**
 * The access code is the Collabo's shared password, so only a hash of it is
 * stored. The plain code can therefore be shown only right after it is created
 * or regenerated (and only from memory). Afterwards the way to "get it back"
 * is to regenerate, never to weaken storage so it can be redisplayed.
 */
export function AccessSection() {
  const { revealedCode, setRevealedCode } = useSessionState()
  const regenerate = useRegenerateCode()
  const [confirming, setConfirming] = useState(false)
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (!revealedCode) return
    if (await copyToClipboard(revealedCode)) {
      setCopied(true)
      toast.success('Code copied')
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Couldn’t copy automatically. Select the code and copy it by hand.')
    }
  }

  return (
    <section aria-labelledby="access-heading" className="mb-8">
      <h2 id="access-heading" className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Collabo access
      </h2>

      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm text-muted">Project code</p>
        <p
          data-testid="access-code"
          aria-label={revealedCode ? undefined : 'Hidden'}
          className="mt-1 select-all font-mono text-xl font-semibold tracking-[0.12em]"
        >
          {revealedCode ?? MASKED_CODE}
        </p>

        {revealedCode ? (
          <p className="mt-2 text-sm text-muted">
            Share this with your team. It’s only visible until you reload this page.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted">
            For safety we keep only a scrambled version of the code, so it can’t be shown again.
            If you need a new one, regenerate it.
          </p>
        )}

        <div className="mt-4 flex flex-wrap gap-2">
          {revealedCode && (
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? 'Copied' : 'Copy Code'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setConfirming(true)}>
            <KeyRound className="size-4" aria-hidden />
            Regenerate Code
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Generate a new code?"
        description="The current code stops working right away, and everyone else is signed out. They’ll need the new code to get back in."
        confirmLabel="Regenerate"
        loading={regenerate.isPending}
        onConfirm={() =>
          regenerate.mutate(undefined, {
            onSuccess: (code) => {
              setRevealedCode(code)
              setConfirming(false)
            },
          })
        }
      />
    </section>
  )
}
