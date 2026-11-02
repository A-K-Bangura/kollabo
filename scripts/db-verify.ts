/**
 * Read-only health report after migrating to V2 (safe to run against production).
 *   npm run db:v2:verify
 * Exits with status 1 if any check marked FAIL found a problem.
 */
import { openDatabase } from '../server/db/client.js'
import { hasFailures, verifyV2 } from '../server/db/verify.js'
import { describeError, loadEnvFiles } from './lib.js'

loadEnvFiles()

async function main(): Promise<void> {
  const { db, close } = await openDatabase()
  try {
    const checks = await verifyV2(db)
    for (const check of checks) {
      const tag = check.severity === 'failure' ? 'FAIL' : check.severity === 'warning' ? 'WARN' : ' ok '
      const line = `[${tag}] ${check.name}: ${check.count}`
      console.log(check.severity === 'info' ? line : `${line}\n         ${check.detail}`)
    }
    if (hasFailures(checks)) {
      console.error('\nProblems found. Do not point the new application at this database until they are resolved.')
      process.exitCode = 1
    } else {
      console.log('\nNo blocking problems found.')
    }
  } finally {
    await close()
  }
}

main().catch((error: unknown) => {
  console.error(`Failed: ${describeError(error)}`)
  process.exitCode = 1
})
