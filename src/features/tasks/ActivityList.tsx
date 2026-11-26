import { MODE_LABELS, STATUS_LABELS } from '@shared/constants'
import type { ActivityDto } from '@shared/types'
import { Button } from '@/components/ui/Button'
import { Skeleton } from '@/components/ui/feedback'
import { formatActivityTime } from '@/lib/dates'
import { useTaskActivityQuery } from './hooks'

const TRIGGER_TEXT: Record<string, string> = {
  group_completion: 'finished for the whole group',
  all_completed: 'everyone’s part is done',
  reopened: 'reopened',
  assignee_added: 'someone was added',
  assignee_removed: 'someone was removed',
  mode_changed: 'who needs to finish changed',
  override: 'changed by an administrator',
}

function status(value: ActivityDto['fromStatus']): string {
  return value ? STATUS_LABELS[value] : '?'
}

/** One sentence for each kind of event, in the order people would read it. */
function describe(entry: ActivityDto): { title: string; detail?: string } {
  const who = entry.actor.name
  const subject = entry.subject?.name ?? 'Someone'
  const trigger = entry.details?.trigger ? TRIGGER_TEXT[entry.details.trigger] : undefined

  switch (entry.action) {
    case 'created':
      return { title: `Created by ${who}` }
    case 'updated':
      return { title: 'Task updated' }
    case 'status_changed':
      return {
        title: `${status(entry.fromStatus)} → ${status(entry.toStatus)}`,
        ...(trigger ? { detail: trigger } : {}),
      }
    case 'assignee_added':
      return { title: `${subject} was assigned` }
    case 'assignee_removed':
      return { title: `${subject} was removed from the task` }
    case 'assignee_status_changed':
      return { title: `${subject}: ${status(entry.fromStatus)} → ${status(entry.toStatus)}` }
    case 'mode_changed': {
      const to = entry.details?.toMode
      return {
        title: to
          ? `Now: ${MODE_LABELS[to].toLowerCase()} ${to === 'all' ? 'must finish their part' : 'can finish it for the group'}`
          : 'Who needs to finish changed',
      }
    }
    case 'note_edited':
      return { title: 'Progress note updated' }
    case 'note_cleared':
      return { title: 'Progress note cleared' }
  }
}

/** Read-only history, oldest first. Activity is never edited or deleted. */
export function ActivityList({ taskId }: { taskId: string }) {
  const activity = useTaskActivityQuery(taskId)

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
            const { title, detail } = describe(entry)
            const reason = entry.details?.reason
            return (
              <li key={entry.id} className="relative">
                <span aria-hidden className="absolute -left-[25px] top-[7px] size-2 rounded-full bg-line ring-4 ring-surface" />
                <p className="text-[15px] font-medium">{title}</p>
                <p className="text-sm text-muted">
                  {entry.actor.name}
                  {entry.actor.type === 'admin' && ' (admin)'} · {formatActivityTime(entry.createdAt)}
                  {detail && ` · ${detail}`}
                </p>
                {reason && <p className="mt-0.5 text-sm text-muted">Reason: {reason}</p>}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
