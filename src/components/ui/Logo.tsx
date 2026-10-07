import { cn } from '@/lib/cn'

/** Two overlapping circles: people working on the same thing. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-7', className)}>
      <circle cx="12" cy="16" r="9" className="fill-accent" />
      <circle cx="20" cy="16" r="9" className="fill-accent/45" />
    </svg>
  )
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <LogoMark />
      <span className="text-[15px] font-semibold uppercase tracking-[0.22em]">Collabo</span>
    </span>
  )
}
