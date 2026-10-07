import { Pool } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-serverless'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { getEnv } from '../env.js'
import * as schema from './schema.js'

/** The driver-agnostic database type every service is written against. */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>

export interface DatabaseHandle {
  db: Database
  /** Releases the connection. Always called when the request finishes. */
  close: () => Promise<void>
}

/**
 * Functions are short-lived and may be frozen between requests, so each request
 * gets its own Neon pool (WebSocket, so interactive transactions work) and
 * closes it before responding.
 */
async function openNeonDatabase(): Promise<DatabaseHandle> {
  const pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 1 })
  pool.on('error', (error: Error) => {
    console.error('[db] pool error', { name: error.name })
  })
  return { db: drizzle(pool, { schema }), close: () => pool.end() }
}

let opener: () => Promise<DatabaseHandle> = openNeonDatabase

export function openDatabase(): Promise<DatabaseHandle> {
  return opener()
}

/** Test seam: lets tests run the real route handlers against an in-process Postgres. */
export function overrideDatabaseOpener(next: (() => Promise<DatabaseHandle>) | null): void {
  opener = next ?? openNeonDatabase
}
