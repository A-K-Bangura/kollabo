import { STATUS_LABELS } from '@shared/constants'
import type { ActivityDto } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/feedback'
import { useMemberLookup } from '@/features/team/hooks'
import { formatActivityTime } from '@/lib/dates'
import { useTaskActivityQuery } from './hooks'

function describe(entry: ActivityDto, who: string): { title: string; detail: string } {
  const time = formatActivityTime(entry.createdAt)
  switch (entry.action) {
    case 'created':
      return { title: `Created by ${who}`, detail: time }
    case 'status_changed':
      return {
        title: `${entry.fromStatus ? STATUS_LABELS[entry.fromStatus] : '?'} → ${entry.toStatus ? STATUS_LABELS[entry.toStatus] : '?'}`,
        detail: `${who} · ${time}`,
      }
    case 'updated':
      return { title: 'Task updated', detail: `${who} · ${time}` }
  }
}

/** Read-only history, oldest first. Activity is never edited or deleted. */
export function ActivityList({ taskId }: { taskId: string }) {
  const activity = useTaskActivityQuery(taskId)
  const { find } = useMemberLookup()

  return (
    <section aria-labelledby="activity-heading">
      <h3 id="activity-heading" className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Activity
      </h3>

      {activity.isPending && (
        <div role="status" aria-label="Loading activity" className="space-y-3">
          <Skeleton className="h-10 w-3/4" />
          <Skeleton className="h-10 w-2/3" />
        </div>
      )}

      {activity.isError && (
        <p role="alert" className="text-[15px] text-muted">
          Couldn’t load the activity.{' '}
          <Button variant="ghost" size="sm" onClick={() => void activity.refetch()}>
            Try again
          </Button>
        </p>
      )}

      {activity.isSuccess && (
        <ol className="space-y-4 border-l border-line pl-5">
          {activity.data.map((entry) => {
            const { title, detail } = describe(entry, find(entry.memberId)?.name ?? 'Someone')
            return (
              <li key={entry.id} className="relative">
                <span aria-hidden className="absolute -left-[25px] top-[7px] size-2 rounded-full bg-line ring-4 ring-surface" />
                <p className="text-[15px] font-medium">{title}</p>
                <p className="text-sm text-muted">{detail}</p>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
