import { and, desc, eq, lt } from 'drizzle-orm'
import type { ActivityAction, ActorType, TaskStatus } from '../../shared/constants.js'
import type { ActivityDetails, ActivityDto } from '../../shared/types.js'
import { actorRef, PUBLIC_ADMIN_NAME, type ReadScope, type Scope } from '../actors.js'
import type { Database } from '../db/client.js'
import { taskActivity, tasks } from '../db/schema.js'
import { ApiError } from '../errors.js'

export interface ActivityEvent {
  action: ActivityAction
  /** The person the event is about: who was assigned, removed, or progressed. */
  subject?: { memberId: string; name: string } | null
  fromStatus?: TaskStatus | null
  toStatus?: TaskStatus | null
  details?: ActivityDetails | null
}

/**
 * Appends events to a task's history, all attributed to the scope's actor. Events
 * from one change share a timestamp and keep their insertion order (the id).
 * Names are stored as snapshots so history stays readable after renames.
 */
export async function recordActivity(
  db: Database,
  scope: Scope,
  taskId: string,
  events: readonly ActivityEvent[],
): Promise<void> {
  if (events.length === 0) return
  const ref = actorRef(scope.actor)
  await db.insert(taskActivity).values(
    events.map((event) => ({
      projectId: scope.projectId,
      taskId,
      actorType: scope.actor.type,
      memberId: ref.memberId,
      adminId: ref.adminId,
      actorName: scope.actor.name,
      action: event.action,
      subjectMemberId: event.subject?.memberId ?? null,
      subjectName: event.subject?.name ?? null,
      fromStatus: event.fromStatus ?? null,
      toStatus: event.toStatus ?? null,
      details: event.details ?? null,
    })),
  )
}

/**
 * `viewer` decides what is shown. Project members never learn which administrator
 * acted (just "Collabo admin") or the reason they gave; admins see everything.
 */
export function toActivityDto(row: typeof taskActivity.$inferSelect, viewer: ActorType): ActivityDto {
  const byAdmin = row.actorType === 'admin'
  const details = (row.details ?? null) as ActivityDetails | null
  const visibleDetails =
    details && viewer === 'member' ? (({ reason: _reason, ...rest }) => rest)(details) : details

  return {
    id: row.id,
    taskId: row.taskId,
    action: row.action,
    memberId: row.memberId,
    actor: {
      type: row.actorType,
      memberId: row.memberId,
      name: byAdmin && viewer === 'member' ? PUBLIC_ADMIN_NAME : (row.actorName ?? 'Someone'),
    },
    subject:
      row.subjectMemberId && row.subjectName
        ? { memberId: row.subjectMemberId, name: row.subjectName }
        : null,
    fromStatus: row.fromStatus,
    toStatus: row.toStatus,
    details: visibleDetails && Object.keys(visibleDetails).length > 0 ? visibleDetails : null,
    createdAt: row.createdAt.toISOString(),
  }
}

export interface ActivityPage {
  /** Oldest first, ready to display. */
  activity: ActivityDto[]
  /** True when older events exist; pass the first id as `before` to load them. */
  hasMore: boolean
}

/** The most recent `limit` events (oldest first), or the page before `before`. */
export async function listActivity(
  db: Database,
  scope: ReadScope,
  taskId: string,
  options: { limit: number; before?: number | undefined },
): Promise<ActivityPage> {
  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.projectId, scope.projectId)),
    columns: { id: true },
  })
  if (!task) throw new ApiError('TASK_NOT_FOUND')

  const rows = await db
    .select()
    .from(taskActivity)
    .where(
      and(
        eq(taskActivity.taskId, taskId),
        eq(taskActivity.projectId, scope.projectId),
        options.before !== undefined ? lt(taskActivity.id, options.before) : undefined,
      ),
    )
    .orderBy(desc(taskActivity.id))
    .limit(options.limit + 1)

  const hasMore = rows.length > options.limit
  const page = rows.slice(0, options.limit).reverse()
  return { activity: page.map((row) => toActivityDto(row, scope.viewer)), hasMore }
}
