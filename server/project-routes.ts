import type { AccessHandler } from './access.js'
import type { Method } from './router-types.js'
import {
  addMembersHandler,
  deactivateMemberHandler,
  listMembersHandler,
  reactivateMemberHandler,
  removeMemberHandler,
  renameMemberHandler,
} from './members/handlers.js'
import {
  clearNoteHandler,
  createTaskHandler,
  deleteTaskHandler,
  editNoteHandler,
  getTaskHandler,
  listTasksHandler,
  noteRevisionsHandler,
  reopenTaskHandler,
  setAssigneeStatusHandler,
  taskActivityHandler,
  updateTaskHandler,
} from './tasks/handlers.js'

export interface AccessRoute {
  method: Method
  /** Relative to the project: `/tasks/:id`. */
  path: string
  handler: AccessHandler
}

/**
 * Everything inside one project: members and tasks. Registered twice by the router:
 * at `/api/...` for project members (their session picks the project) and at
 * `/api/admin/projects/:projectId/...` for platform admins (the route picks it).
 */
export const projectRoutes: AccessRoute[] = [
  { method: 'GET', path: '/members', handler: listMembersHandler },
  { method: 'POST', path: '/members', handler: addMembersHandler },
  { method: 'PATCH', path: '/members/:id', handler: renameMemberHandler },
  { method: 'DELETE', path: '/members/:id', handler: removeMemberHandler },
  { method: 'POST', path: '/members/:id/deactivate', handler: deactivateMemberHandler },
  { method: 'POST', path: '/members/:id/reactivate', handler: reactivateMemberHandler },

  { method: 'GET', path: '/tasks', handler: listTasksHandler },
  { method: 'POST', path: '/tasks', handler: createTaskHandler },
  { method: 'GET', path: '/tasks/:id', handler: getTaskHandler },
  { method: 'PATCH', path: '/tasks/:id', handler: updateTaskHandler },
  { method: 'DELETE', path: '/tasks/:id', handler: deleteTaskHandler },
  { method: 'GET', path: '/tasks/:id/activity', handler: taskActivityHandler },
  { method: 'PUT', path: '/tasks/:id/assignees/:memberId/status', handler: setAssigneeStatusHandler },
  { method: 'POST', path: '/tasks/:id/reopen', handler: reopenTaskHandler },
  { method: 'PUT', path: '/tasks/:id/note', handler: editNoteHandler },
  { method: 'DELETE', path: '/tasks/:id/note', handler: clearNoteHandler },
  { method: 'GET', path: '/tasks/:id/note/revisions', handler: noteRevisionsHandler },
]
