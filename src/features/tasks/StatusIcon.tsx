import type { TaskStatus } from '@shared/constants'
import { cn } from '@/lib/cn'

/**
 * Three states, three shapes: an empty ring (To Do), a half-filled ring (In
 * Progress) and a filled check (Done). Shape, not just colour, carries the meaning.
 */
export function StatusIcon({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={cn('size-6 shrink-0', className)}>
      {status === 'todo' && (
        <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" className="stroke-muted/70" />
      )}
      {status === 'in_progress' && (
        <>
          <circle cx="12" cy="12" r="9" fill="none" strokeWidth="2" className="stroke-warn" />
          <path d="M12 6.5a5.5 5.5 0 0 1 0 11z" className="fill-warn" />
        </>
      )}
      {status === 'completed' && (
        <>
          <circle cx="12" cy="12" r="10" className="fill-success" />
          <path
            d="M7.8 12.4l2.9 2.9 5.5-5.8"
            fill="none"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="stroke-surface"
          />
        </>
      )}
    </svg>
  )
}
