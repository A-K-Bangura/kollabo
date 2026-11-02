import type { AdminAuditEntryDto } from '@shared/types'
import { Link } from 'react-router'
import { formatActivityTime } from '@/lib/dates'

const ACTION_TEXT: Record<string, string> = {
  'project.rename': 'Renamed the project',
  'project.suspend': 'Suspended the project',
  'project.reactivate': 'Reactivated the project',
  'project.delete': 'Deleted the project',
  'project.restore': 'Restored the project',
  'project.rotate_code': 'Rotated the access code',
  'member.add': 'Added members',
  'member.rename': 'Renamed a member',
  'member.deactivate': 'Removed a member',
  'member.reactivate': 'Brought a member back',
  'task.create': 'Created a task',
  'task.update': 'Edited a task',
  'task.delete': 'Deleted a task',
  'task.progress_override': 'Changed someone’s progress',
  'task.reopen': 'Reopened a task',
  'task.note_edit': 'Edited a progress note',
  'task.note_clear': 'Cleared a progress note',
  'admin.sign_in': 'Signed in',
  'admin.sign_out': 'Signed out',
  'admin.mfa_enrolled': 'Turned on two-factor authentication',
  'admin.password_changed': 'Changed their password',
  'admin.backup_codes_regenerated': 'Regenerated backup codes',
  'admin.create': 'Added an administrator',
  'admin.deactivate': 'Deactivated an administrator',
  'admin.reactivate': 'Reactivated an administrator',
}

export function auditText(action: string): string {
  return ACTION_TEXT[action] ?? action
}

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
