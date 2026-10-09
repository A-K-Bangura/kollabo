import { createHmac } from 'node:crypto'
import { eq, lt, sql } from 'drizzle-orm'
import type { Database } from '../db/client.js'
import { rateLimits } from '../db/schema.js'
import { getEnv } from '../env.js'
import { ApiError } from '../errors.js'

export interface RateLimitPolicy {
  name: string
  maxAttempts: number
  windowSeconds: number
}

/** Failed access-code guesses per client. A correct code never counts. */
export const ACCESS_CODE_POLICY: RateLimitPolicy = {
  name: 'access-code',
  maxAttempts: 10,
  windowSeconds: 15 * 60,
}

/** New Collabos per client, to stop someone filling the database. */
export const CREATE_PROJECT_POLICY: RateLimitPolicy = {
  name: 'create-project',
  maxAttempts: 10,
  windowSeconds: 60 * 60,
}

/**
 * Counters live in Postgres because serverless instances share no memory.
 * The client IP is only ever stored as a keyed hash.
 */
function bucketKey(policy: RateLimitPolicy, request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  const ip = request.headers.get('x-real-ip') ?? forwarded ?? 'unknown'
  const digest = createHmac('sha256', getEnv().SESSION_SECRET).update(`rate:${ip}`).digest('hex')
  return `${policy.name}:${digest.slice(0, 32)}`
}

function limited(retryAfterSeconds: number): ApiError {
  return new ApiError('RATE_LIMITED', {
    headers: { 'retry-after': String(Math.max(1, Math.ceil(retryAfterSeconds))) },
  })
}

/** Throws RATE_LIMITED when this client has already used up the policy's attempts. */
export async function assertWithinLimit(
  db: Database,
  policy: RateLimitPolicy,
  request: Request,
): Promise<void> {
  const [row] = await db
    .select({ attempts: rateLimits.attempts, windowStart: rateLimits.windowStart })
    .from(rateLimits)
    .where(eq(rateLimits.key, bucketKey(policy, request)))
  if (!row || row.attempts < policy.maxAttempts) return

  const resetsAt = row.windowStart.getTime() + policy.windowSeconds * 1000
  if (resetsAt > Date.now()) throw limited((resetsAt - Date.now()) / 1000)
}

/** Counts one attempt in a fixed window (atomic upsert) and returns the new total. */
export async function recordAttempt(
  db: Database,
  policy: RateLimitPolicy,
  request: Request,
): Promise<number> {
  const expired = sql`${rateLimits.windowStart} <= now() - make_interval(secs => ${policy.windowSeconds})`
  const key = bucketKey(policy, request)

  const [row] = await db
    .insert(rateLimits)
    .values({ key, attempts: 1 })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        attempts: sql`case when ${expired} then 1 else ${rateLimits.attempts} + 1 end`,
        windowStart: sql`case when ${expired} then now() else ${rateLimits.windowStart} end`,
      },
    })
    .returning({ attempts: rateLimits.attempts })

  // Housekeeping: stale buckets are meaningless after a day.
  await db.delete(rateLimits).where(lt(rateLimits.windowStart, sql`now() - interval '1 day'`))

  return row?.attempts ?? 1
}

/** Counts an attempt up front and rejects once the policy is exceeded. */
export async function consumeAttempt(
  db: Database,
  policy: RateLimitPolicy,
  request: Request,
): Promise<void> {
  const attempts = await recordAttempt(db, policy, request)
  if (attempts > policy.maxAttempts) throw limited(policy.windowSeconds)
}
