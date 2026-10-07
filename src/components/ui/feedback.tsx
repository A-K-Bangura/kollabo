import { CircleAlert, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button } from './Button'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-xl bg-raised', className)} />
}

export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle className={cn('size-5 animate-spin text-muted', className)} aria-hidden />
}

/** Placeholder rows while a task list loads. */
export function TaskListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading tasks" className="space-y-1 rounded-2xl border border-line bg-surface p-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="flex items-center gap-3 px-1 py-2.5">
          <Skeleton className="size-6 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  )
}

interface EmptyStateProps {
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <p className="text-base font-medium">{title}</p>
      {description && <p className="mt-1 max-w-xs text-[15px] text-muted">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

interface ErrorStateProps {
  message: string
  onRetry?: () => void
  className?: string
}

export function ErrorState({ message, onRetry, className }: ErrorStateProps) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-6 py-14 text-center', className)}>
      <CircleAlert className="mb-3 size-7 text-danger" aria-hidden />
      <p className="font-medium">Something went wrong</p>
      <p className="mt-1 max-w-xs text-[15px] text-muted">{message}</p>
      {onRetry && (
        <Button variant="secondary" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  )
}

interface InlineAlertProps {
  tone?: 'danger' | 'warn'
  children: ReactNode
  action?: ReactNode
}

export function InlineAlert({ tone = 'danger', children, action }: InlineAlertProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 rounded-xl p-3.5 text-[15px] sm:flex-row sm:items-center sm:justify-between',
        tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-warn-soft text-warn',
      )}
    >
      <p className="font-medium">{children}</p>
      {action}
    </div>
  )
}

/** Shown while the very first request decides which screen to display. */
export function FullScreenLoading() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-label="Loading">
      <Spinner className="size-6" />
    </div>
  )
}
