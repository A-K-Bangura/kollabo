import { existsSync, readdirSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { loadEnv, type Plugin } from 'vite'

/**
 * Serves the functions in /api during `vite dev`, mirroring Vercel's file-system
 * routing, so `npm run dev` is the only command a developer needs. It is never
 * part of a production build: production uses real Vercel Functions.
 */
export function apiDevServer(): Plugin {
  let apiDir = ''

  return {
    name: 'collabo-api-dev-server',
    apply: 'serve',

    config(config, { mode }) {
      const root = config.root ?? process.cwd()
      apiDir = path.resolve(root, 'api')
      // Vite only exposes VITE_* variables to the client. Server secrets from
      // .env files are loaded into process.env here, for the functions only.
      for (const [key, value] of Object.entries(loadEnv(mode, root, ''))) {
        if (process.env[key] === undefined) process.env[key] = value
      }
    },

    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost')
        if (!url.pathname.startsWith('/api/')) return next()

        try {
          const segments = url.pathname.split('/').filter(Boolean).slice(1)
          const file = resolveRoute(apiDir, segments)
          if (!file) return sendJson(res, 404, 'NOT_FOUND', 'No such API route.')

          const module = (await server.ssrLoadModule(file)) as Record<string, unknown>
          const handler = module[req.method ?? 'GET']
          if (typeof handler !== 'function') {
            return sendJson(res, 405, 'METHOD_NOT_ALLOWED', 'Method not allowed.')
          }

          const response = (await handler(await toRequest(req))) as Response
          await writeResponse(res, response)
        } catch (error) {
          server.config.logger.error(`[api] ${error instanceof Error ? error.message : 'failed'}`)
          sendJson(res, 500, 'SERVER_ERROR', 'The API route failed to run.')
        }
      })
    },
  }
}

function isDirectory(target: string): boolean {
  return existsSync(target) && statSync(target).isDirectory()
}

/** Maps URL segments onto api/ files: exact names first, then [param] names. */
function resolveRoute(dir: string, segments: string[]): string | null {
  const [head, ...rest] = segments
  if (head === undefined) {
    const index = path.join(dir, 'index.ts')
    return existsSync(index) ? index : null
  }

  if (rest.length === 0) {
    const file = path.join(dir, `${head}.ts`)
    if (existsSync(file)) return file
  }

  const exactDir = path.join(dir, head)
  if (isDirectory(exactDir)) {
    const found = resolveRoute(exactDir, rest)
    if (found) return found
  }

  for (const entry of readdirSync(dir)) {
    const dynamic = /^\[[^\]]+\](\.ts)?$/.exec(entry)
    if (!dynamic) continue
    const full = path.join(dir, entry)
    if (dynamic[1]) {
      if (rest.length === 0) return full
    } else if (isDirectory(full)) {
      const found = resolveRoute(full, rest)
      if (found) return found
    }
  }
  return null
}

async function toRequest(req: IncomingMessage): Promise<Request> {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
    else if (value !== undefined) headers.set(key, value)
  }

  const method = req.method ?? 'GET'
  let body: Uint8Array<ArrayBuffer> | undefined
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Uint8Array[] = []
    for await (const chunk of req) chunks.push(chunk as Uint8Array)
    const joined = Buffer.concat(chunks)
    if (joined.length > 0) body = new Uint8Array(joined)
  }

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
  return new Request(url, { method, headers, body })
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    if (key !== 'set-cookie') res.setHeader(key, value)
  })
  const cookies = response.headers.getSetCookie()
  if (cookies.length > 0) res.setHeader('set-cookie', cookies)
  res.end(Buffer.from(await response.arrayBuffer()))
}

function sendJson(res: ServerResponse, status: number, code: string, message: string): void {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify({ error: { code, message } }))
}
