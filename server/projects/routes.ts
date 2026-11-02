import type { Route } from '../router-types.js'
import {
  createProjectHandler,
  createSessionHandler,
  deleteSessionHandler,
  getProjectHandler,
  regenerateCodeHandler,
} from './handlers.js'

/** Project-level routes that are not shared with the admin area. */
export const sessionRoutes: Route[] = [
  { method: 'POST', path: '/api/projects', handler: createProjectHandler },
  { method: 'POST', path: '/api/session', handler: createSessionHandler },
  { method: 'DELETE', path: '/api/session', handler: deleteSessionHandler },
  { method: 'GET', path: '/api/project', handler: getProjectHandler },
  { method: 'POST', path: '/api/project/regenerate-code', handler: regenerateCodeHandler },
]
