import { ApiError } from '../errors.js'
import type { Handler, RequestContext } from '../http.js'
import { requireAdmin, type AdminSession } from './session.js'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export function isUnsafe(request: Request): boolean {
  return !SAFE_METHODS.has(request.method)
}

/**
 * CSRF protection for everything administrators can change. Layered on purpose:
 *
 *  1. the sign-in cookie is SameSite=Strict, so browsers do not attach it to
 *     cross-site requests at all;
 *  2. every state-changing request must carry an `Origin` header naming this exact host
 *     (browsers always send one on such requests; unlike the project API, a request
 *     without it is refused rather than assumed to be a non-browser client);
 *  3. when the browser reports `Sec-Fetch-Site`, it must say same-origin;
 *  4. bodies must be JSON, which a plain cross-site HTML form cannot send.
 */
export function assertAdminRequest(request: Request): void {
  if (!isUnsafe(request)) return

  const origin = request.headers.get('origin')
  if (!origin) throw new ApiError('FORBIDDEN_ORIGIN')
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new ApiError('FORBIDDEN_ORIGIN')
  }
  if (originHost !== host) throw new ApiError('FORBIDDEN_ORIGIN')

  const fetchSite = request.headers.get('sec-fetch-site')
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new ApiError('FORBIDDEN_ORIGIN')
  }
}

export type AdminHandler = (ctx: RequestContext, admin: AdminSession) => Promise<Response>

interface AdminHandlerOptions {
  /** For the few endpoints that finish account setup (see requireAdmin). */
  allowIncompleteSetup?: boolean
  /**
   * Run state-changing requests inside one transaction (the default). Handlers that must
   * count a failure (a wrong password) even though they then reject the request opt out,
   * because a rolled-back transaction would roll the failure count back with it.
   */
  transactional?: boolean
}

/**
 * Wraps an admin endpoint. In order: CSRF check, then the administrator check (no valid
 * session, deactivated, password not yet changed, or no two-factor means a refusal before
 * any handler code runs), then the handler. State-changing requests run inside one
 * database transaction, so a change and its audit-log row are committed together or not at all.
 */
export function adminHandler(handler: AdminHandler, options: AdminHandlerOptions = {}): Handler {
  return async (ctx) => {
    assertAdminRequest(ctx.request)
    const admin = await requireAdmin(ctx, options)
    if (!isUnsafe(ctx.request) || options.transactional === false) return handler(ctx, admin)
    return ctx.db.transaction((tx) => handler({ ...ctx, db: tx }, admin))
  }
}
