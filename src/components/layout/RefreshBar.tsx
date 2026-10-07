import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/Button'
import { useReportError } from '@/features/session/hooks'
import { useRefreshAction, useTasksQuery } from '@/features/tasks/hooks'
import { formatRefreshed } from '@/lib/dates'
import { useNow } from '@/lib/useNow'

/**
 * Collabo has no live sync, so this is the one way teammates' changes arrive.
 * It says plainly when the screen was last brought up to date.
 */
export function RefreshBar({ label = 'Refresh tasks' }: { label?: string }) {
  const tasks = useTasksQuery()
  const refresh = useRefreshAction()
  const report = useReportError()
  const now = useNow()
  const [refreshing, setRefreshing] = useState(false)

  const onRefresh = async () => {
    setRefreshing(true)
    try {
      await refresh()
    } catch (error) {
      report(error)
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="flex items-center justify-between gap-3">
      <p aria-live="polite" className="min-w-0 truncate text-sm text-muted">
        {tasks.dataUpdatedAt > 0 && `Last refreshed ${formatRefreshed(tasks.dataUpdatedAt, now)}`}
      </p>
      <Button variant="secondary" size="sm" onClick={() => void onRefresh()} disabled={refreshing}>
        <RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} aria-hidden />
        {label}
      </Button>
    </div>
  )
}
