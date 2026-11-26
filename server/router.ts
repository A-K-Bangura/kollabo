import { memberAccess, withProject } from './auth.js'
import { openDatabase } from './db/client.js'
import { ApiError } from './errors.js'
import { assertSameOrigin, errorResponse, matchPath } from './http.js'
import { projectRoutes } from './project-routes.js'
import { sessionRoutes } from './projects/routes.js'
import type { Method, Route } from './router-types.js'

/**
 * The project-member API: session routes plus everything inside a project, bound to the
 * project and member of the caller's session.
 */
const MEMBER_ROUTES: Route[] = [
  ...sessionRoutes,
  ...projectRoutes.map(
    (route): Route => ({
      method: route.method,
      path: `/api${route.path}`,
      handler: withProject((ctx, session) => route.handler(ctx, memberAccess(ctx, session))),
    }),
  ),
]

/**
 * Admin and sign-in routes are loaded on demand: they pull in the authentication
 * library, which ordinary project traffic should never have to load.
 */
async function routesFor(pathname: string): Promise<readonly Route[]> {
  if (pathname.startsWith('/api/admin/') || pathname.startsWith('/api/auth/')) {
    return (await import('./admin/routes.js')).adminRoutes
  }
  return MEMBER_ROUTES
}

type Match = { route: Route; params: Record<string, string> }

function findRoute(routes: readonly Route[], method: string, pathname: string): Match {
  const allowed = new Set<Method>()
  for (const route of routes) {
    const params = matchPath(route.path, pathname)
    if (!params) continue
    if (route.method === method) return { route, params }
    allowed.add(route.method)
  }
  if (allowed.size > 0) {
    throw new ApiError('METHOD_NOT_ALLOWED', { headers: { allow: [...allowed].join(', ') } })
  }
  throw new ApiError('NOT_FOUND')
}

/**
 * The one Vercel Function behind every /api route. It matches the path, opens a
 * per-request database connection, closes it afterwards, and converts every
 * failure into the standard error body.
 */
export async function handleApi(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request)
    const { pathname } = new URL(request.url)
    const { route, params } = findRoute(await routesFor(pathname), request.method, pathname)

    const { db, close } = await openDatabase()
    try {
      return await route.handler({ request, db, params })
    } finally {
      await close().catch(() => undefined)
    }
  } catch (error) {
    return errorResponse(error, request)
  }
}
