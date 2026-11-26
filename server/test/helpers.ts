import type { TaskStatus } from '../../shared/constants.js'
import type { ActivityDto, AssigneeDto, NoteRevisionDto, TaskDto } from '../../shared/types.js'
import type { ApiResult, TestClient } from './client.js'

export type TaskResult = ApiResult<{ task: TaskDto }>

/** One person's own progress on a task. */
export function setStatus(
  client: TestClient,
  task: TaskDto,
  memberId: string,
  status: TaskStatus,
  extra: Record<string, unknown> = {},
): Promise<TaskResult> {
  const row = task.assignees.find((assignee) => assignee.memberId === memberId)
  return client.put<{ task: TaskDto }>(`/api/tasks/${task.id}/assignees/${memberId}/status`, {
    body: { status, expectedAssigneeVersion: row?.version ?? 1, ...extra },
  })
}

export async function fetchTask(client: TestClient, taskId: string): Promise<TaskDto> {
  const result = await client.get<{ task: TaskDto }>(`/api/tasks/${taskId}`)
  if (result.status !== 200) throw new Error(`fetchTask failed: ${JSON.stringify(result.body)}`)
  return result.body.task
}

export function assignee(task: TaskDto, memberId: string): AssigneeDto {
  const found = task.assignees.find((row) => row.memberId === memberId)
  if (!found) throw new Error(`${memberId} is not assigned`)
  return found
}

export async function activityOf(client: TestClient, taskId: string): Promise<ActivityDto[]> {
  const result = await client.get<{ activity: ActivityDto[] }>(`/api/tasks/${taskId}/activity`)
  return result.body.activity
}

export async function revisionsOf(client: TestClient, taskId: string): Promise<NoteRevisionDto[]> {
  const result = await client.get<{ revisions: NoteRevisionDto[] }>(`/api/tasks/${taskId}/note/revisions`)
  return result.body.revisions
}

/** Compact "action:subject from>to" strings, for asserting what history says happened. */
export function describeActivity(activity: readonly ActivityDto[]): string[] {
  return activity.map((entry) => {
    const status = entry.fromStatus ? ` ${entry.fromStatus}>${entry.toStatus}` : ''
    const subject = entry.subject ? `:${entry.subject.name}` : ''
    return `${entry.action}${subject}${status}`
  })
}
