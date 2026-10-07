import { z } from 'zod'
import type { ApiErrorBody } from '../shared/errors.js'
import { uuidSchema } from '../shared/schemas.js'
import { openDatabase, type Database } from './db/client.js'
import { ConfigError } from './env.js'
import { ApiError, pgErrorCode } from './errors.js'
import { buildClearedSessionCookie } from './security/session.js'

export interface RequestContext {
  request: Request
  db: Database
  /** Path parameters from the route pattern, e.g. { id } for /api/tasks/:id. */
  params: Record<string, string>
}

export type Handler = (ctx: RequestContext) => Promise<Response>

const MAX_BODY_BYTES = 32 * 1024
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

interface JsonInit {
  status?: number
  headers?: Record<string, string>
  cookies?: string[]
}

/** API responses are never cacheable: they can contain a team's private tasks. */
export function json(body: unknown, init: JsonInit = {}): Response {
  const headers = new Headers(init.headers)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  for (const cookie of init.cookies ?? []) headers.append('set-cookie', cookie)
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers })
}

export function noContent(init: Pick<JsonInit, 'cookies'> = {}): Response {
  const headers = new Headers({ 'cache-control': 'no-store' })
  for (const cookie of init.cookies ?? []) headers.append('set-cookie', cookie)
  return new Response(null, { status: 204, headers })
}

/** Matches '/api/tasks/:id' against a pathname. Returns null when it does not fit. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const expected = pattern.split('/').filter(Boolean)
  const actual = pathname.split('/').filter(Boolean)
  if (expected.length !== actual.length) return null

  const params: Record<string, string> = {}
  for (let index = 0; index < expected.length; index += 1) {
    const want = expected[index]!
    const got = actual[index]!
    if (want.startsWith(':')) {
      try {
        params[want.slice(1)] = decodeURIComponent(got)
      } catch {
        return null
      }
    } else if (want !== got) {
      return null
    }
  }
  return params
}

function validationError(error: z.ZodError): ApiError {
  return new ApiError('VALIDATION_ERROR', {
    message: error.issues[0]?.message,
    details: z.flattenError(error).fieldErrors as Record<string, string[]>,
  })
}

/** Parses and validates a JSON request body. Nothing reaches a service unvalidated. */
export async function readJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.output<T>> {
  const contentType = request.headers.get('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError('UNSUPPORTED_MEDIA_TYPE')
  }
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    throw new ApiError('PAYLOAD_TOO_LARGE')
  }

  const text = await request.text()
  if (text.length > MAX_BODY_BYTES) throw new ApiError('PAYLOAD_TOO_LARGE')

  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ApiError('VALIDATION_ERROR', { message: 'Request body must be valid JSON.' })
  }

  const parsed = schema.safeParse(data)
  if (!parsed.success) throw validationError(parsed.error)
  return parsed.data
}

/** Validates a path parameter that must be a UUID. */
export function parseId(value: string | undefined): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR', { message: 'Invalid id.' })
  return parsed.data
}

/**
 * CSRF defence in depth on top of SameSite=Strict: a browser-initiated write
 * that names a different origin is refused. (Non-browser clients send no Origin.)
 */
function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return
  const origin = request.headers.get('origin')
  if (!origin) return

  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host
  let originHost: string
  try {
    originHost = new URL(origin).host
  } catch {
    throw new ApiError('FORBIDDEN_ORIGIN')
  }
  if (originHost !== host) throw new ApiError('FORBIDDEN_ORIGIN')
}

function errorResponse(error: unknown, request: Request): Response {
  if (error instanceof ApiError) {
    const headers = { ...error.headers }
    const cookies = error.code === 'SESSION_INVALID' ? [buildClearedSessionCookie(request)] : []
    const body: ApiErrorBody = {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
    }
    return json(body, { status: error.status, headers, cookies })
  }

  // Unexpected failure. Log a safe summary only: driver errors can embed query
  // text and bound values (names, hashes), and none of that may reach logs or clients.
  console.error('[api] unhandled error', {
    method: request.method,
    path: new URL(request.url).pathname,
    name: error instanceof Error ? error.name : typeof error,
    pgCode: pgErrorCode(error),
    ...(error instanceof ConfigError ? { message: error.message } : {}),
  })
  const body: ApiErrorBody = { error: { code: 'SERVER_ERROR', message: new ApiError('SERVER_ERROR').message } }
  return json(body, { status: 500 })
}

/**
 * Wraps a handler as a Vercel Function method export: matches the path, opens a
 * per-request database connection, closes it afterwards, and converts every
 * failure into the standard error body.
 */
export function handle(pattern: string, handler: Handler): (request: Request) => Promise<Response> {
  return async (request) => {
    try {
      assertSameOrigin(request)
      const params = matchPath(pattern, new URL(request.url).pathname)
      if (!params) throw new ApiError('NOT_FOUND')

      const { db, close } = await openDatabase()
      try {
        return await handler({ request, db, params })
      } finally {
        await close().catch(() => undefined)
      }
    } catch (error) {
      return errorResponse(error, request)
    }
  }
}
