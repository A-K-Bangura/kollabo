import type { CSSProperties } from 'react'
import { cn } from '@/lib/cn'

/** A stable hue per name, so the same person always gets the same colour. */
function hueFor(name: string): number {
  let hash = 0
  for (const char of name.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return hash
}

interface AvatarProps {
  name: string
  className?: string
}

export function Avatar({ name, className }: AvatarProps) {
  const initial = name.trim().charAt(0).toUpperCase() || '?'
  return (
    <span
      aria-hidden
      style={{ '--h': hueFor(name) } as CSSProperties}
      className={cn(
        'inline-flex size-9 shrink-0 select-none items-center justify-center rounded-full text-sm font-semibold',
        'bg-[hsl(var(--h)_45%_88%)] text-[hsl(var(--h)_50%_26%)]',
        'dark:bg-[hsl(var(--h)_28%_26%)] dark:text-[hsl(var(--h)_60%_86%)]',
        className,
      )}
    >
      {initial}
    </span>
  )
}
