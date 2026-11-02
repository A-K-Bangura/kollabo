import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createCollabo, createTask } from '../test/client.js'
import { createTestDatabase, type TestDatabase } from '../test/database.js'
import { hasFailures, verifyV2, type VerifyCheck } from './verify.js'

let database: TestDatabase
beforeAll(async () => {
  database = await createTestDatabase()
})
afterAll(() => database.close())

const problem = (checks: VerifyCheck[], name: string) => checks.find((check) => check.name.startsWith(name))

describe('the post-migration health check', () => {
  it('reports a healthy database as healthy, and administrators as missing', async () => {
    const team = await createCollabo()
    await createTask(team.client, { title: 'Healthy' })
    const checks = await verifyV2(database.db)
    expect(hasFailures(checks)).toBe(false)
    expect(problem(checks, 'Active administrators')).toMatchObject({ count: 0, severity: 'warning' })
    expect(problem(checks, 'Rows: tasks')?.count).toBeGreaterThanOrEqual(1)
  })

  it('catches a task that lost its assignee row, a status that disagrees, and a note without history', async () => {
    const team = await createCollabo()
    const lost = await createTask(team.client, { title: 'Lost its row' })
    const wrong = await createTask(team.client, { title: 'Wrong status' })
    const note = await createTask(team.client, { title: 'Phantom note' })

    // 1. V1 recorded an assignee but the backfill did not create the row.
    await database.db.execute(sql`delete from task_assignees where task_id = ${lost.id}`)
    await database.db.execute(
      sql`update tasks set assigned_to_member_id = ${team.creator.id} where id = ${lost.id}`,
    )
    // 2. Marked completed although its only assignee has not finished.
    await database.db.execute(
      sql`update tasks set status = 'completed', completed_at = now(), completed_by_member_id = ${team.creator.id} where id = ${wrong.id}`,
    )
    // 3. A note that no revision explains.
    await database.db.execute(
      sql`update tasks set progress_note = 'Out of nowhere', progress_note_version = 1, note_updated_at = now() where id = ${note.id}`,
    )

    const checks = await verifyV2(database.db)
    expect(hasFailures(checks)).toBe(true)
    expect(problem(checks, 'V1 tasks missing')).toMatchObject({ count: 1, severity: 'failure' })
    expect(problem(checks, 'ALL-mode tasks whose status')).toMatchObject({ count: 1, severity: 'failure' })
    expect(problem(checks, 'Tasks whose note version')).toMatchObject({ count: 1, severity: 'failure' })
  })
})
