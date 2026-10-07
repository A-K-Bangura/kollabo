/**
 * One place for every query key. `task(id)` deliberately starts with 'task'
 * (singular) so invalidating ['task'] refreshes open task details without
 * touching the ['tasks'] list.
 */
export const queryKeys = {
  project: ['project'] as const,
  members: ['members'] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['task', id] as const,
  taskActivity: (id: string) => ['task', id, 'activity'] as const,
}
