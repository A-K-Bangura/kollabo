import type { ProjectStatus } from '@shared/constants'
import { formatDistanceToNowStrict, parseISO } from 'date-fns'
import { RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'
import { formatRefreshed } from '@/lib/dates'
import { useNow } from '@/lib/useNow'

const PILL: Record<ProjectStatus, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-success-soft text-success' },
  suspended: { label: 'Suspended', className: 'bg-warn-soft text-warn' },
  deleted: { label: 'Deleted', className: 'bg-danger-soft text-danger' },
}

export function ProjectStatusPill({ status }: { status: ProjectStatus }) {
  const { label, className } = PILL[status]
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', className)}>
      {label}
    </span>
  )
}

export function relativeTime(iso: string): string {
  return `${formatDistanceToNowStrict(parseISO(iso))} ago`
}

interface StatProps {
  label: string
  value: number | string
  hint?: string
  tone?: 'warn' | 'danger'
  to?: string
}

/** One number, one label. A link when there is somewhere sensible to go from it. */
export function Stat({ label, value, hint, tone, to }: StatProps) {
  const body = (
    <>
      <p className="text-sm text-muted">{label}</p>
      <p className={cn('mt-1 text-3xl font-semibold tabular-nums tracking-tight', tone === 'warn' && 'text-warn', tone === 'danger' && 'text-danger')}>
        {value}
      </p>
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </>
  )
  const base = 'rounded-2xl border border-line bg-surface p-4'
  return to ? (
    <Link to={to} className={cn(base, 'block transition hover:bg-raised/60')}>
      {body}
    </Link>
  ) : (
    <div className={base}>{body}</div>
  )
}

export function SectionHeading({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h2 id={id} className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
      {children}
    </h2>
  )
}

interface AdminRefreshProps {
  updatedAt: number
  onRefresh: () => Promise<unknown>
  refreshing: boolean
  label?: string
}

/** Same promise as the rest of Collabo: nothing updates itself, and the page says when it last did. */
export function AdminRefresh({ updatedAt, onRefresh, refreshing, label = 'Refresh' }: AdminRefreshProps) {
  const now = useNow()
  return (
    <div className="flex items-center justify-between gap-3">
      <p aria-live="polite" className="min-w-0 truncate text-sm text-muted">
        {updatedAt > 0 && `Last refreshed ${formatRefreshed(updatedAt, now)}`}
      </p>
      <Button variant="secondary" size="sm" onClick={() => void onRefresh()} disabled={refreshing}>
        <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
        {label}
      </Button>
    </div>
  )
}
