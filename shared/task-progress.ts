import type { AssignmentMode, TaskStatus } from './constants.js'

/**
 * The rules for how individual progress becomes a task's overall status.
 * Pure functions, shared by the server (which applies them inside transactions)
 * and the browser (which uses them to explain what a change will do).
 *
 *   ALL  Every active assignee completes their own part. The task is completed
 *        exactly when all of them are; otherwise it is in progress once anyone
 *        has started, else to do. Completely derived from the assignees.
 *
 *   ANY  One assignee can complete the whole task for the group. Completion is
 *        STICKY: once completed it stays completed (whatever happens to the
 *        assignees) until someone explicitly reopens it. Before completion the
 *        status is derived: in progress once anyone has started, else to do.
 */

export interface ProgressRow {
  status: TaskStatus
}

export interface DatedProgressRow extends ProgressRow {
  memberId: string
  completedAt: string | null
}

function startedAny(rows: readonly ProgressRow[]): boolean {
  return rows.some((row) => row.status !== 'todo')
}

function statusForAll(rows: readonly ProgressRow[]): TaskStatus {
  if (rows.every((row) => row.status === 'completed')) return 'completed'
  return startedAny(rows) ? 'in_progress' : 'todo'
}

function statusWhileOpen(rows: readonly ProgressRow[]): TaskStatus {
  return startedAny(rows) ? 'in_progress' : 'todo'
}

/**
 * The task's overall status given its mode, the status it currently has, and its
 * active assignees. A task with no assignees (possible only for tasks that predate
 * V2's "at least one assignee" rule) keeps whatever status it has.
 */
export function aggregateStatus(
  mode: AssignmentMode,
  current: TaskStatus,
  rows: readonly ProgressRow[],
): TaskStatus {
  if (rows.length === 0) return current
  if (mode === 'all') return statusForAll(rows)
  return current === 'completed' ? 'completed' : statusWhileOpen(rows)
}

/**
 * The status after switching between modes, deterministic and documented:
 *
 *  - ANY -> ALL: ALL's own rule applied to the individual statuses. Only people who
 *    explicitly completed count as individually complete, so an ANY task that one
 *    person finished becomes "in progress" when others are still outstanding.
 *  - ALL -> ANY: the task is completed if it already was, or if any assignee had
 *    already completed their part (one completion is enough under ANY). Otherwise
 *    it is derived as usual.
 */
export function statusAfterModeChange(
  from: AssignmentMode,
  to: AssignmentMode,
  current: TaskStatus,
  rows: readonly ProgressRow[],
): TaskStatus {
  if (rows.length === 0) return current
  if (from === to) return aggregateStatus(to, current, rows)
  if (to === 'all') return statusForAll(rows)
  if (current === 'completed' || rows.some((row) => row.status === 'completed')) return 'completed'
  return statusWhileOpen(rows)
}

/** Whether changing the mode would be a meaningful (confirmable) change for this task. */
export function hasProgress(current: TaskStatus, rows: readonly ProgressRow[]): boolean {
  return current !== 'todo' || startedAny(rows)
}

/**
 * Which assignee's completion represents the task's completion when a mode
 * switch completes it: the most recent one (ties broken by member id so the
 * result never depends on row order).
 */
export function latestCompleter<T extends DatedProgressRow>(rows: readonly T[]): T | null {
  const completed = rows.filter((row) => row.status === 'completed')
  if (completed.length === 0) return null
  return [...completed].sort(
    (a, b) =>
      (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || a.memberId.localeCompare(b.memberId),
  )[0]!
}

/**
 * Whether people may change their own progress right now. A group-completed ANY
 * task is finished: nothing implicitly reopens it; someone has to reopen it.
 */
export function ownProgressBlock(mode: AssignmentMode, current: TaskStatus): 'GROUP_COMPLETED' | null {
  return mode === 'any' && current === 'completed' ? 'GROUP_COMPLETED' : null
}

/** The step the one-tap progress button takes: To Do, In Progress, Done, and a finished part reopens to In Progress. */
export function nextOwnStatus(status: TaskStatus): TaskStatus {
  switch (status) {
    case 'todo':
      return 'in_progress'
    case 'in_progress':
      return 'completed'
    case 'completed':
      return 'in_progress'
  }
}

export function progressCounts(rows: readonly ProgressRow[]): { completed: number; total: number } {
  return { completed: rows.filter((row) => row.status === 'completed').length, total: rows.length }
}

/** What a mode switch would do, for the confirmation dialog. */
export function describeModeChange(
  from: AssignmentMode,
  to: AssignmentMode,
  current: TaskStatus,
  rows: readonly ProgressRow[],
): { before: TaskStatus; after: TaskStatus; changesStatus: boolean; needsConfirmation: boolean } {
  const after = statusAfterModeChange(from, to, current, rows)
  return {
    before: current,
    after,
    changesStatus: after !== current,
    needsConfirmation: from !== to && hasProgress(current, rows),
  }
}
