import { cn } from '@/lib/cn'

export type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type Size = 'sm' | 'md' | 'lg'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-raised',
  ghost: 'text-muted hover:bg-raised hover:text-ink',
  danger: 'bg-danger text-danger-ink hover:opacity-90',
}

const SIZES: Record<Size, string> = {
  sm: 'h-9 gap-1.5 px-3 text-sm',
  md: 'h-11 gap-2 px-4 text-[15px]',
  lg: 'h-12 gap-2 px-5 text-base',
}

/** Shared by <Button> and router links that should look like buttons. */
export function buttonStyles(variant: Variant = 'primary', size: Size = 'md', extra?: string) {
  return cn(
    'inline-flex shrink-0 items-center justify-center rounded-xl font-medium transition',
    'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    extra,
  )
}
