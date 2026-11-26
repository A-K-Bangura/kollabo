import type { Handler } from './http.js'

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface Route {
  method: Method
  /** Full path with `:param` segments, e.g. `/api/tasks/:id`. */
  path: string
  handler: Handler
}
