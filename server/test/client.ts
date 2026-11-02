import { randomInt } from 'node:crypto'
import * as entry from '../../api/[...path].js'
import { MEMBER_HEADER } from '../../shared/constants.js'
import type { CreateProjectResponse, MemberDto, TaskDto } from '../../shared/types.js'

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export interface ApiResult<T = unknown> {
  status: number
  body: T
  headers: Headers
  setCookies: string[]
}

export interface SendOptions {
  body?: unknown
  /** Raw body text, to send malformed JSON. */
  rawBody?: string
  headers?: Record<string, string>
  /** Acting member header: defaults to the client's current member; null omits it. */
  actor?: string | null
}

/**
 * A stand-in for one browser: keeps its own cookie jar and client IP, and calls
 * the real exported route handlers exactly as Vercel would (Request in, Response out).
 */
export class TestClient {
  readonly ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`
  memberId: string | null = null
  private readonly jar = new Map<string, string>()

  get sessionCookie(): string | undefined {
    return this.jar.get('collabo_session')
  }

  setSessionCookie(value: string): void {
    this.jar.set('collabo_session', value)
  }

  /** A second browser carrying a copy of this browser's cookie. */
  clone(): TestClient {
    const copy = new TestClient()
    for (const [name, value] of this.jar) copy.jar.set(name, value)
    copy.memberId = this.memberId
    return copy
  }

  async send<T = unknown>(
    method: Method,
    path: string,
    options: SendOptions = {},
  ): Promise<ApiResult<T>> {
    const headers = new Headers({
      'x-real-ip': this.ip,
      ...(options.body !== undefined || options.rawBody !== undefined
        ? { 'content-type': 'application/json' }
        : {}),
      ...options.headers,
    })
    const cookie = [...this.jar].map(([name, value]) => `${name}=${value}`).join('; ')
    if (cookie) headers.set('cookie', cookie)
    const actor = options.actor === undefined ? this.memberId : options.actor
    if (actor) headers.set(MEMBER_HEADER, actor)

    const body = options.rawBody ?? (options.body === undefined ? undefined : JSON.stringify(options.body))
    // The real Vercel entry point: one function serving every /api route.
    const response = await entry[method](
      new Request(`https://collabo.test${path}`, { method, headers, body }),
    )

    const setCookies = response.headers.getSetCookie()
    for (const raw of setCookies) {
      const [pair = '', ...attributes] = raw.split(';').map((part) => part.trim())
      const separator = pair.indexOf('=')
      const name = pair.slice(0, separator)
      const value = pair.slice(separator + 1)
      const expired = attributes.some((attribute) => attribute.toLowerCase() === 'max-age=0')
      if (expired || value === '') this.jar.delete(name)
      else this.jar.set(name, value)
    }

    const text = await response.text()
    return {
      status: response.status,
      body: (text ? JSON.parse(text) : null) as T,
      headers: response.headers,
      setCookies,
    }
  }

  get = <T>(path: string, options?: SendOptions) => this.send<T>('GET', path, options)
  post = <T>(path: string, options?: SendOptions) => this.send<T>('POST', path, options)
  put = <T>(path: string, options?: SendOptions) => this.send<T>('PUT', path, options)
  patch = <T>(path: string, options?: SendOptions) => this.send<T>('PATCH', path, options)
  delete = <T>(path: string, options?: SendOptions) => this.send<T>('DELETE', path, options)
}

export interface Collabo {
  /** Signed in, acting as the creator. */
  client: TestClient
  projectId: string
  code: string
  creator: MemberDto
  members: MemberDto[]
  /** A member by name. */
  member: (name: string) => MemberDto
  /** A second browser in the same Collabo, acting as the named member. */
  as: (name: string) => TestClient
}

/** Creates a Collabo through the public API; the returned client is signed in as its creator. */
export async function createCollabo(
  options: { name?: string; creatorName?: string; memberNames?: string[] } = {},
): Promise<Collabo> {
  const client = new TestClient()
  const result = await client.post<CreateProjectResponse>('/api/projects', {
    body: {
      name: options.name ?? 'Test Collabo',
      creatorName: options.creatorName ?? 'Alhaji',
      memberNames: options.memberNames ?? ['Mariama', 'Ibrahim'],
    },
  })
  if (result.status !== 201) throw new Error(`createCollabo failed: ${JSON.stringify(result.body)}`)

  const { project, members, creatorMemberId, accessCode } = result.body
  const creator = members.find((member) => member.id === creatorMemberId)
  if (!creator) throw new Error('creator missing from members')
  client.memberId = creator.id

  const member = (name: string): MemberDto => {
    const found = members.find((candidate) => candidate.name === name)
    if (!found) throw new Error(`No member named ${name}`)
    return found
  }
  const as = (name: string): TestClient => {
    const copy = client.clone()
    copy.memberId = member(name).id
    return copy
  }
  return { client, projectId: project.id, code: accessCode, creator, members, member, as }
}

/** Signs a fresh browser in with a code, as a teammate would. */
export async function joinWithCode(code: string): Promise<TestClient> {
  const client = new TestClient()
  const result = await client.post('/api/session', { body: { code } })
  if (result.status !== 200) throw new Error(`joinWithCode failed: ${JSON.stringify(result.body)}`)
  return client
}

export async function createTask(
  client: TestClient,
  input: Record<string, unknown> = {},
): Promise<TaskDto> {
  // Every task needs at least one assignee: default to the creator.
  const assignees =
    'assigneeIds' in input || 'assignedToMemberId' in input
      ? {}
      : { assigneeIds: client.memberId ? [client.memberId] : [] }
  const result = await client.post<{ task: TaskDto }>('/api/tasks', {
    body: { title: 'Finish landing page', ...assignees, ...input },
  })
  if (result.status !== 201) throw new Error(`createTask failed: ${JSON.stringify(result.body)}`)
  return result.body.task
}
