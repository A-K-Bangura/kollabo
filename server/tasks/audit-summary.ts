import type { TaskDto } from '../../shared/types.js'

/**
 * A small, safe description of what an admin's task edit changed, for the audit log.
 * Scalar fields as `{ from, to }`; people are counted, not listed. No notes, codes or secrets.
 */
export function summarizeTaskChange(before: TaskDto, after: TaskDto): Record<string, unknown> {
  const summary: Record<string, unknown> = { title: after.title }
  const note = (field: string, from: unknown, to: unknown) => {
    if (from !== to) summary[field] = { from, to }
  }
  note('renamed', before.title, after.title)
  note('priority', before.priority, after.priority)
  note('dueDate', before.dueDate, after.dueDate)
  note('mode', before.assignmentMode, after.assignmentMode)
  note('status', before.status, after.status)

  const beforeIds = new Set(before.assignees.map((row) => row.memberId))
  const afterIds = new Set(after.assignees.map((row) => row.memberId))
  const added = [...afterIds].filter((id) => !beforeIds.has(id)).length
  const removed = [...beforeIds].filter((id) => !afterIds.has(id)).length
  if (added > 0 || removed > 0) summary.assignees = { added, removed, now: afterIds.size }
  return summary
}
