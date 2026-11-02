import type { AdminAuditEntryDto } from '@shared/types'
import { Link } from 'react-router'
import { formatActivityTime } from '@/lib/dates'
import { auditText } from './auditLabels'

/** Small before/after facts, as "title: Launch · to: Done". Never anything secret: the server never records those. */
function facts(summary: Record<string, unknown> | null): string[] {
  if (!summary) return []
  return Object.entries(summary)
    .filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value) || value === null)
    .map(([key, value]) => `${key}: ${value === null ? '—' : String(value)}`)
}

interface AuditEntriesProps {
  entries: AdminAuditEntryDto[]
  /** Link each entry to its project (the global log); the project's own log doesn't need to. */
  showProject?: boolean
}

export function AuditEntries({ entries, showProject = false }: AuditEntriesProps) {
  return (
    <ol aria-label="Audit log" className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
      {entries.map((entry) => {
        const details = facts(entry.summary)
        return (
          <li key={entry.id} className="px-4 py-3">
            <p className="text-[15px] font-medium">{auditText(entry.action)}</p>
            <p className="text-sm text-muted">
              {entry.adminName} <span className="[overflow-wrap:anywhere]">({entry.adminEmail})</span> · {formatActivityTime(entry.createdAt)}
              {showProject && entry.projectId && (
                <>
                  {' · '}
                  <Link to={`/admin/projects/${entry.projectId}`} className="font-medium text-accent underline-offset-2 hover:underline">
                    Open project
                  </Link>
                </>
              )}
            </p>
            {entry.reason && <p className="mt-1 text-sm">Reason: {entry.reason}</p>}
            {details.length > 0 && (
              <p className="mt-1 text-sm text-muted [overflow-wrap:anywhere]">{details.join(' · ')}</p>
            )}
          </li>
        )
      })}
    </ol>
  )
}
