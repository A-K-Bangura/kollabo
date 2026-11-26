import { PauseCircle } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/Button'
import { useLeaveCollabo, useProjectQuery } from '@/features/session/hooks'
import { isSuspendedError } from '@/lib/api'

/**
 * What a Collabo's members see while a platform administrator has suspended it. Nothing is
 * lost: the tasks and the code are exactly as they were, and everything comes back the
 * moment it is reactivated. The page says who can help rather than hinting at a fault.
 */
export function SuspendedPage() {
  const project = useProjectQuery()
  const leave = useLeaveCollabo()
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)

  const checkAgain = async () => {
    setChecking(true)
    try {
      const result = await project.refetch()
      if (result.isSuccess) {
        void navigate('/today', { replace: true })
      } else if (isSuspendedError(result.error)) {
        toast('Still suspended.')
      } else {
        toast.error(result.error?.message ?? 'Couldn’t check just now. Try again in a moment.')
      }
    } finally {
      setChecking(false)
    }
  }

  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="w-full max-w-sm text-center">
        <span className="mx-auto mb-5 flex size-14 items-center justify-center rounded-full bg-warn-soft text-warn">
          <PauseCircle className="size-7" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">This Collabo is paused</h1>
        <p className="mt-3 text-[15px] text-muted">
          A Collabo platform administrator has suspended it, so nobody can open it right now.
        </p>
        <p className="mt-2 text-[15px] text-muted">
          Nothing has been lost. Your tasks, notes and team are exactly as you left them, and
          everything comes back as soon as it’s reactivated. Contact whoever runs Collabo for you
          to find out more.
        </p>

        <div className="mt-8 flex flex-col gap-2">
          <Button size="lg" onClick={() => void checkAgain()} loading={checking}>
            Check again
          </Button>
          <Button variant="ghost" onClick={() => leave.mutate()} loading={leave.isPending}>
            Use a different Collabo
          </Button>
        </div>
      </div>
    </main>
  )
}
