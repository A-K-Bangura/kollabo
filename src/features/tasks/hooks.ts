import { STATUS_LABELS, type TaskStatus } from '@shared/constants'
import type { CreateTaskInput, UpdateTaskInput } from '@shared/schemas'
import type { ActivityDto, TaskDto } from '@shared/types'
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import { toast } from 'sonner'
import { useCurrentMember } from '@/features/session/context'
import { useReportError } from '@/features/session/hooks'
import { api, isConflict } from '@/lib/api'
import { queryKeys } from '@/lib/queryKeys'

export function useTasksQuery() {
  return useQuery({ queryKey: queryKeys.tasks, queryFn: api.listTasks })
}

/**
 * A single task. When the list is already loaded the task is read from it (no
 * request); only a direct link to a task not in the list fetches it by id.
 */
export function useTaskQuery(id: string) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: queryKeys.task(id),
    queryFn: () => api.getTask(id),
    initialData: () =>
      queryClient.getQueryData<TaskDto[]>(queryKeys.tasks)?.find((task) => task.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(queryKeys.tasks)?.dataUpdatedAt,
    retry: false,
  })
}

export function useTaskActivityQuery(id: string) {
  return useQuery<ActivityDto[]>({
    queryKey: queryKeys.taskActivity(id),
    queryFn: () => api.listActivity(id),
  })
}

/**
 * Applies the person's own change to the cached list. The cache's "last
 * refreshed" time is preserved on purpose: updating one row is not a refresh,
 * and the label must not claim teammates' changes were fetched.
 */
function patchTasks(queryClient: QueryClient, update: (tasks: TaskDto[]) => TaskDto[]): void {
  const state = queryClient.getQueryState<TaskDto[]>(queryKeys.tasks)
  if (!state?.data) return
  queryClient.setQueryData(queryKeys.tasks, update(state.data), { updatedAt: state.dataUpdatedAt })
}

export function useCreateTask() {
  const queryClient = useQueryClient()
  const member = useCurrentMember()
  const report = useReportError()

  return useMutation({
    mutationFn: (input: CreateTaskInput) => api.createTask(input, member.id),
    onSuccess: (task) => {
      patchTasks(queryClient, (tasks) => [task, ...tasks.filter((existing) => existing.id !== task.id)])
      queryClient.setQueryData(queryKeys.task(task.id), task)
    },
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
  const queryClient = useQueryClient()
  const member = useCurrentMember()

  return useMutation({
    mutationFn: ({ task, changes }: UpdateVariables) =>
      api.updateTask(task.id, { ...changes, expectedVersion: task.version }, member.id),
    onSuccess: (updated) => {
      patchTasks(queryClient, (tasks) =>
        tasks.map((existing) => (existing.id === updated.id ? updated : existing)),
      )
      queryClient.setQueryData(queryKeys.task(updated.id), updated)
      // The person's own change added history; fetch it (inactive copies refetch when next opened).
      void queryClient.invalidateQueries({ queryKey: queryKeys.taskActivity(updated.id) })
    },
  })
}

export function useDeleteTask() {
  const queryClient = useQueryClient()
  const report = useReportError()

  return useMutation({
    mutationFn: (task: TaskDto) => api.deleteTask(task.id),
    onSuccess: (_result, task) => {
      patchTasks(queryClient, (tasks) => tasks.filter((existing) => existing.id !== task.id))
      queryClient.removeQueries({ queryKey: queryKeys.task(task.id), type: 'inactive' })
    },
    onError: report,
  })
}

/**
 * The manual refresh. Re-fetches the task list and team, and any open task
 * (details and history). This is the only way other people's changes arrive.
 */
export function useRefreshAction() {
  const queryClient = useQueryClient()
  return useCallback(
    () =>
      Promise.all([
        queryClient.refetchQueries({ queryKey: queryKeys.tasks }, { throwOnError: true }),
        queryClient.refetchQueries({ queryKey: queryKeys.members }, { throwOnError: true }),
        // Prefix match: every ['task', id] and ['task', id, 'activity'] query.
        queryClient.invalidateQueries({ queryKey: ['task'] }),
      ]),
    [queryClient],
  )
}

/** One-tap status changes from lists and the detail view, with conflict handling. */
export function useChangeStatus() {
  const update = useUpdateTask()
  const refresh = useRefreshAction()
  const report = useReportError()

  const change = useCallback(
    (task: TaskDto, status: TaskStatus) => {
      update.mutate(
        { task, changes: { status } },
        {
          onSuccess: (updated) => toast.success(`Moved to ${STATUS_LABELS[updated.status]}`),
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
    [update, refresh, report],
  )

  return { change, isPending: update.isPending }
}
