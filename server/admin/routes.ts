import { projectRoutes } from '../project-routes.js'
import type { Route } from '../router-types.js'
import { authRoutes } from './auth-routes.js'
import {
  asAdmin,
  auditLogHandler,
  createAdminHandler,
  deactivateAdminHandler,
  deleteProjectHandler,
  getProjectHandler,
  listAdminsHandler,
  listProjectsHandler,
  meHandler,
  overviewHandler,
  projectAuditHandler,
  reactivateAdminHandler,
  reactivateProjectHandler,
  renameProjectHandler,
  restoreProjectHandler,
  rotateCodeHandler,
  suspendProjectHandler,
} from './handlers.js'

/**
 * Platform administration. Every handler here is wrapped by `adminHandler`, which checks the
 * origin and then the administrator (valid session, active account, new password chosen,
 * two-factor enrolled) before any of the handler's own code runs; there is no admin route
 * that skips it. The project-level routes reuse the very same handlers project members use,
 * so an administrator can do anything a member can, with their own identity recorded.
 */
const ADMIN_ROUTES: Route[] = [
  { method: 'GET', path: '/api/admin/me', handler: meHandler },
  { method: 'GET', path: '/api/admin/overview', handler: overviewHandler },

  { method: 'GET', path: '/api/admin/projects', handler: listProjectsHandler },
  { method: 'GET', path: '/api/admin/projects/:projectId', handler: getProjectHandler },
  { method: 'PATCH', path: '/api/admin/projects/:projectId', handler: renameProjectHandler },
  { method: 'POST', path: '/api/admin/projects/:projectId/suspend', handler: suspendProjectHandler },
  { method: 'POST', path: '/api/admin/projects/:projectId/reactivate', handler: reactivateProjectHandler },
  { method: 'POST', path: '/api/admin/projects/:projectId/delete', handler: deleteProjectHandler },
  { method: 'POST', path: '/api/admin/projects/:projectId/restore', handler: restoreProjectHandler },
  { method: 'POST', path: '/api/admin/projects/:projectId/rotate-code', handler: rotateCodeHandler },
  { method: 'GET', path: '/api/admin/projects/:projectId/audit', handler: projectAuditHandler },

  { method: 'GET', path: '/api/admin/audit', handler: auditLogHandler },

  { method: 'GET', path: '/api/admin/admins', handler: listAdminsHandler },
  { method: 'POST', path: '/api/admin/admins', handler: createAdminHandler },
  { method: 'POST', path: '/api/admin/admins/:id/deactivate', handler: deactivateAdminHandler },
  { method: 'POST', path: '/api/admin/admins/:id/reactivate', handler: reactivateAdminHandler },
]

/** Members and tasks of any project, through the same handlers members use. */
const ADMIN_PROJECT_ROUTES: Route[] = projectRoutes.map((route) => ({
  method: route.method,
  path: `/api/admin/projects/:projectId${route.path}`,
  handler: asAdmin(route.handler),
}))

export const adminRoutes: Route[] = [...authRoutes, ...ADMIN_ROUTES, ...ADMIN_PROJECT_ROUTES]
