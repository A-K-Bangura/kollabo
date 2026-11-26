import { STATUS_LABELS, type TaskStatus } from '@shared/constants'
import type { CreateTaskInput, UpdateTaskInput } from '@shared/schemas'
import type { ActivityDto, NoteRevisionDto, TaskDto } from '@shared/types'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { useProjectKeys, useProjectScope } from '@/features/scope/useScope'
import { useReportError } from '@/features/session/hooks'
import { isConflict } from '@/lib/api'

export function useTasksQuery() {
  const scope = useProjectScope()
  const keys = useProjectKeys()
  return useQuery({ queryKey: keys.tasks, queryFn: scope.api.listTasks })
}

/**
 * A single task. When the list is already loaded the task is read from it (no
 * request); only a direct link to a task not in the list fetches it by id.
 */
export function useTaskQuery(id: string) {
  const queryClient = useQueryClient()
  const scope = useProjectScope()
  const keys = useProjectKeys()
  return useQuery({
    queryKey: keys.task(id),
    queryFn: () => scope.api.getTask(id),
    initialData: () => queryClient.getQueryData<TaskDto[]>(keys.tasks)?.find((task) => task.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(keys.tasks)?.dataUpdatedAt,
    retry: false,
  })
}

export function useTaskActivityQuery(id: string) {
  const scope = useProjectScope()
  const keys = useProjectKeys()
  return useQuery<ActivityDto[]>({
    queryKey: keys.taskActivity(id),
    queryFn: () => scope.api.listActivity(id),
  })
}

/** The note's edit history, fetched only when someone opens it. */
export function useNoteRevisionsQuery(id: string, enabled: boolean) {
  const scope = useProjectScope()
  const keys = useProjectKeys()
  return useQuery<NoteRevisionDto[]>({
    queryKey: keys.taskNotes(id),
    queryFn: () => scope.api.listNoteRevisions(id),
    enabled,
  })
}

/**
 * Applies the person's own change to the cached list. The cache's "last
 * refreshed" time is preserved on purpose: updating one row is not a refresh,
 * and the label must not claim teammates' changes were fetched.
 */
function patchTasks(
  queryClient: QueryClient,
  tasksKey: readonly unknown[],
  update: (tasks: TaskDto[]) => TaskDto[],
): void {
  const state = queryClient.getQueryState<TaskDto[]>(tasksKey)
  if (!state?.data) return
  queryClient.setQueryData(tasksKey, update(state.data), { updatedAt: state.dataUpdatedAt })
}

/** After any change that returns the task: put it in the list and the detail cache, and mark its history stale. */
function useApplyTask() {
  const queryClient = useQueryClient()
  const keys = useProjectKeys()
  return useCallback(
    (task: TaskDto) => {
      patchTasks(queryClient, keys.tasks, (tasks) =>
        tasks.some((existing) => existing.id === task.id)
          ? tasks.map((existing) => (existing.id === task.id ? task : existing))
          : [task, ...tasks],
      )
      queryClient.setQueryData(keys.task(task.id), task)
      // The person's own change added history; fetch it (inactive copies refetch when next opened).
      void queryClient.invalidateQueries({ queryKey: keys.taskActivity(task.id) })
      void queryClient.invalidateQueries({ queryKey: keys.taskNotes(task.id) })
    },
    [queryClient, keys],
  )
}

export function useCreateTask() {
  const scope = useProjectScope()
  const apply = useApplyTask()
  const report = useReportError()
  return useMutation({
    mutationFn: (input: CreateTaskInput) => scope.api.createTask(input),
    onSuccess: apply,
    onError: report,
  })
}

interface UpdateVariables {
  task: TaskDto
  changes: Omit<UpdateTaskInput, 'expectedVersion'>
}

/**
 * Edits send the version the person loaded; a stale one comes back as a 409
 * (see isConflict). Callers decide how to present failures.
 */
export function useUpdateTask() {
  const scope = useProjectScope()
  const apply = useApplyTask()
  return useMutation({
    mutationFn: ({ task, changes }: UpdateVariables) =>
      scope.api.updateTask(task.id, { ...changes, expectedVersion: task.version }),
    onSuccess: apply,
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  const scope = useProjectScope()
  const keys = useProjectKeys()
  const report = useReportError()
  return useMutation({
    mutationFn: ({ task, reason }: { task: TaskDto; reason?: string }) =>
      scope.api.deleteTask(task.id, reason),
    onSuccess: (_result, { task }) => {
      patchTasks(queryClient, keys.tasks, (tasks) => tasks.filter((existing) => existing.id !== task.id))
      queryClient.removeQueries({ queryKey: keys.task(task.id), type: 'inactive' })
    },
    onError: report,
  })
}

interface ProgressVariables {
  task: TaskDto
  memberId: string
  status: TaskStatus
  /** Optional shared note to write along with the change. Blank leaves the note alone. */
  note?: string
  /** Required when an administrator changes someone else's progress. */
  reason?: string
}

/**
 * One person's own progress. Sends that person's version (teammates progressing at the
 * same time do not conflict) and, only when a note was typed, the note version it was
 * written against.
 */
export function useSetAssigneeStatus() {
  const scope = useProjectScope()
  const apply = useApplyTask()
  return useMutation({
    mutationFn: ({ task, memberId, status, note, reason }: ProgressVariables) => {
      const row = task.assignees.find((assignee) => assignee.memberId === memberId)
      const trimmed = note?.trim()
      return scope.api.setAssigneeStatus(task.id, memberId, {
        status,
        expectedAssigneeVersion: row?.version ?? 1,
        ...(trimmed ? { note: trimmed, expectedNoteVersion: task.progressNoteVersion } : {}),
        ...(reason ? { reason } : {}),
      })
    },
    onSuccess: apply,
  })
}

export function useReopenTask() {
  const scope = useProjectScope()
  const apply = useApplyTask()
  return useMutation({
    mutationFn: ({ task, note, reason }: { task: TaskDto; note?: string; reason?: string }) => {
      const trimmed = note?.trim()
      return scope.api.reopenTask(task.id, {
        expectedVersion: task.version,
        ...(trimmed ? { note: trimmed, expectedNoteVersion: task.progressNoteVersion } : {}),
        ...(reason ? { reason } : {}),
      })
    },
    onSuccess: apply,
  })
}

export function useEditNote() {
  const scope = useProjectScope()
  const apply = useApplyTask()
  return useMutation({
    mutationFn: ({ task, content, reason }: { task: TaskDto; content: string; reason?: string }) =>
      scope.api.editNote(task.id, {
        content,
        expectedNoteVersion: task.progressNoteVersion,
        ...(reason ? { reason } : {}),
      }),
    onSuccess: apply,
  })
}

export function useClearNote() {
  const scope = useProjectScope()
  const apply = useApplyTask()
  return useMutation({
    mutationFn: ({ task, reason }: { task: TaskDto; reason?: string }) =>
      scope.api.clearNote(task.id, { expectedNoteVersion: task.progressNoteVersion, reason }),
    onSuccess: apply,
  })
}

/**
 * The manual refresh. Re-fetches the task list and team, and any open task
 * (details, history and note history). This is the only way other people's changes arrive.
 */
export function useRefreshAction() {
  const queryClient = useQueryClient()
  const keys = useProjectKeys()
  return useCallback(
    () =>
      Promise.all([
        queryClient.refetchQueries({ queryKey: keys.tasks }, { throwOnError: true }),
        queryClient.refetchQueries({ queryKey: keys.members }, { throwOnError: true }),
        // Prefix match: every task, task history and note history query.
        queryClient.invalidateQueries({ queryKey: keys.taskPrefix }),
      ]),
    [queryClient, keys],
  )
}

/**
 * One-tap changes to your own progress from lists and the detail view, with conflict
 * handling. Administrators have no progress of their own; they use the override dialog.
 */
export function useOwnProgress() {
  const mutation = useSetAssigneeStatus()
  const refresh = useRefreshAction()
  const report = useReportError()
  const { me } = useProjectScope()

  const change = useCallback(
    (task: TaskDto, status: TaskStatus, extras: { note?: string; onDone?: () => void } = {}) => {
      if (!me) return
      mutation.mutate(
        { task, memberId: me.id, status, ...(extras.note ? { note: extras.note } : {}) },
        {
          onSuccess: (updated) => {
            toast.success(
              updated.status === 'completed' && task.assignmentMode === 'any'
                ? 'Task marked done for everyone'
                : `Your part moved to ${STATUS_LABELS[status]}`,
            )
            extras.onDone?.()
          },
          onError: (error) => {
            if (isConflict(error)) {
              toast.error(error.message, {
                action: { label: 'Refresh', onClick: () => void refresh() },
              })
            } else {
              report(error)
            }
          },
        },
      )
    },
    [mutation, me, refresh, report],
  )

  return { change, isPending: mutation.isPending }
}
