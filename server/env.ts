import { z } from 'zod'

const envSchema = z.object({
  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, 'must be a postgres:// connection string'),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  ACCESS_CODE_PEPPER: z.string().min(32, 'must be at least 32 characters'),
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
  if (parsed.data.SESSION_SECRET === parsed.data.ACCESS_CODE_PEPPER) {
    throw new ConfigError('Invalid server environment: SESSION_SECRET and ACCESS_CODE_PEPPER must differ')
  }

  cached = parsed.data
  return cached
}
