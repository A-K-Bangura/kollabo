import { z } from 'zod'
import { ApiError } from './errors.js'

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_CODE_PEPPER: z.string().min(32, 'must be at least 32 characters'),
  /**
   * Signs and encrypts the platform-admin sign-in system (sessions, two-factor secrets).
   * Optional on purpose: a deployment without it keeps working for ordinary users and
   * simply has no admin area (503) until it is set.
   */
  ADMIN_AUTH_SECRET: z.string().min(32, 'must be at least 32 characters').optional(),
})

export type Env = z.infer<typeof envSchema>

/** Thrown for missing/invalid configuration. The message names variables, never values. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

let cached: Env | undefined

/** Validates server-only configuration once per function instance. */
export function getEnv(): Env {
  if (cached) return cached

  const parsed = envSchema.safeParse(process.env)
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')} ${issue.message}`)
      .join('; ')
    throw new ConfigError(`Invalid server environment: ${problems}`)
  }
  const secrets = [
    parsed.data.SESSION_SECRET,
    parsed.data.ACCESS_CODE_PEPPER,
    ...(parsed.data.ADMIN_AUTH_SECRET ? [parsed.data.ADMIN_AUTH_SECRET] : []),
  ]
  if (new Set(secrets).size !== secrets.length) {
    throw new ConfigError(
      'Invalid server environment: SESSION_SECRET, ACCESS_CODE_PEPPER and ADMIN_AUTH_SECRET must all differ',
    )
  }

  cached = parsed.data
  return cached
}

/** Test seam: forget the validated environment so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined
}

/** The admin sign-in secret, or a clear "not configured" refusal (503) for admin routes. */
export function getAdminSecret(): string {
  const secret = getEnv().ADMIN_AUTH_SECRET
  if (!secret) throw new ApiError('ADMIN_NOT_CONFIGURED')
  return secret
}
