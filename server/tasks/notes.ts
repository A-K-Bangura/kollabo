import { and, desc, eq, lt, sql } from 'drizzle-orm'
import type { ActorType } from '../../shared/constants.js'
import type { NoteRevisionDto, TaskDto } from '../../shared/types.js'
import { actorRef, PUBLIC_ADMIN_NAME, type Actor, type ReadScope, type Scope } from '../actors.js'
import type { Database } from '../db/client.js'
import { taskNoteRevisions, tasks } from '../db/schema.js'
import { ApiError } from '../errors.js'
import { recordActivity, type ActivityEvent } from './activity.js'
import { loadTask } from './dto.js'
import {
  activeAssignees,
  lockTask,
  saveTask,
  type AssigneeRow,
  type TaskRow,
  type TaskSet,
} from './internal.js'

/** Members may edit the note when they are assigned to the task; admins may always. */
export function assertCanEditNote(actor: Actor, assignees: readonly AssigneeRow[]): void {
  if (actor.type === 'admin') return
  if (!assignees.some((row) => row.memberId === actor.memberId)) throw new ApiError('NOT_ASSIGNED')
}

export interface NoteChange {
  /** null = deliberately clear the note. */
  content: string | null
  expectedNoteVersion: number
  reason?: string | undefined
}

export interface PreparedNote {
  /** Columns to merge into the task update. */
  set: TaskSet
  event: ActivityEvent
}

/**
 * Checks the note version, writes the immutable revision, and returns what the task
 * row and activity log need. Returns null when nothing would actually change (same text,
 * or clearing an already-empty note), so no empty revision is ever created.
 *
 * The task must already be locked. A stale `expectedNoteVersion` throws NOTE_CONFLICT and
 * writes nothing, so the winner's content is preserved; the unique (task, revision)
 * index is a second guard.
 */
export async function prepareNoteChange(
  db: Database,
  scope: Scope,
  task: TaskRow,
  change: NoteChange,
): Promise<PreparedNote | null> {
  if (task.progressNoteVersion !== change.expectedNoteVersion) throw new ApiError('NOTE_CONFLICT')

  if (change.content === null ? task.progressNote === null : change.content === task.progressNote) {
    return null
  }

  const revision = task.progressNoteVersion + 1
  const ref = actorRef(scope.actor)
  await db.insert(taskNoteRevisions).values({
    projectId: scope.projectId,
    taskId: task.id,
    revisionNumber: revision,
    content: change.content,
    isClear: change.content === null,
    editorType: scope.actor.type,
    editorMemberId: ref.memberId,
    editorAdminId: ref.adminId,
    editorName: scope.actor.name,
  })

  return {
    set: {
      progressNote: change.content,
      progressNoteVersion: revision,
      noteUpdatedAt: sql`now()`,
      noteUpdatedByMemberId: ref.memberId,
      noteUpdatedByAdminId: ref.adminId,
      noteUpdatedByName: scope.actor.name,
    },
    event: {
      action: change.content === null ? 'note_cleared' : 'note_edited',
      details: { revision, ...(change.reason ? { reason: change.reason } : {}) },
    },
  }
}

async function changeNote(
  db: Database,
  scope: Scope,
  taskId: string,
  change: NoteChange,
): Promise<TaskDto> {
  await db.transaction(async (tx) => {
    const task = await lockTask(tx, scope.projectId, taskId)
    assertCanEditNote(scope.actor, await activeAssignees(tx, scope.projectId, taskId))
    const prepared = await prepareNoteChange(tx, scope, task, change)
    if (!prepared) return
    await saveTask(tx, scope, task, prepared.set)
    await recordActivity(tx, scope, taskId, [prepared.event])
  })
  return loadTask(db, scope.projectId, scope.actor.type, taskId)
}

/** Replace the shared note. Reverting to identical text creates no revision. */
export function editNote(
  db: Database,
  scope: Scope,
  taskId: string,
  input: { content: string; expectedNoteVersion: number; reason?: string | undefined },
): Promise<TaskDto> {
  return changeNote(db, scope, taskId, {
    content: input.content,
    expectedNoteVersion: input.expectedNoteVersion,
    reason: input.reason,
  })
}

/** The explicit "clear note" action: keeps a tombstone revision, so clearing is never confused with leaving a field empty. */
export function clearNote(
  db: Database,
  scope: Scope,
  taskId: string,
  input: { expectedNoteVersion: number; reason?: string | undefined },
): Promise<TaskDto> {
  return changeNote(db, scope, taskId, {
    content: null,
    expectedNoteVersion: input.expectedNoteVersion,
    reason: input.reason,
  })
}

function toRevisionDto(row: typeof taskNoteRevisions.$inferSelect, viewer: ActorType): NoteRevisionDto {
  const byAdmin = row.editorType === 'admin'
  return {
    id: row.id,
    revisionNumber: row.revisionNumber,
    content: row.content,
    isClear: row.isClear,
    editor: {
      type: row.editorType,
      memberId: row.editorMemberId,
      name: byAdmin && viewer === 'member' ? PUBLIC_ADMIN_NAME : row.editorName,
    },
    createdAt: row.createdAt.toISOString(),
  }
}

/** Revisions are read-only. Newest first; `before` is a revision number for paging. */
export async function listRevisions(
  db: Database,
  scope: ReadScope,
  taskId: string,
  options: { limit: number; before?: number | undefined },
): Promise<{ revisions: NoteRevisionDto[]; hasMore: boolean }> {
  const task = await db.query.tasks.findFirst({
    where: and(eq(tasks.id, taskId), eq(tasks.projectId, scope.projectId)),
    columns: { id: true },
  })
  if (!task) throw new ApiError('TASK_NOT_FOUND')

  const rows = await db
    .select()
    .from(taskNoteRevisions)
    .where(
      and(
        eq(taskNoteRevisions.taskId, taskId),
        eq(taskNoteRevisions.projectId, scope.projectId),
        options.before !== undefined ? lt(taskNoteRevisions.revisionNumber, options.before) : undefined,
      ),
    )
    .orderBy(desc(taskNoteRevisions.revisionNumber))
    .limit(options.limit + 1)

  return {
    revisions: rows.slice(0, options.limit).map((row) => toRevisionDto(row, scope.viewer)),
    hasMore: rows.length > options.limit,
  }
}

