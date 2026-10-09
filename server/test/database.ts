import path from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { overrideDatabaseOpener, type Database } from '../db/client.js'
import * as schema from '../db/schema.js'

export interface TestDatabase {
  db: Database
  close: () => Promise<void>
}

/**
 * A real Postgres (PGlite, in process) built from the generated SQL migrations,
 * installed as the database every route handler opens. Constraints, composite
 * foreign keys and transactions therefore behave exactly as in production.
 */
export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite()
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, '../db/migrations') })

  overrideDatabaseOpener(async () => ({ db, close: async () => undefined }))
  return {
    db,
    close: async () => {
      overrideDatabaseOpener(null)
      await client.close()
    },
  }
}
