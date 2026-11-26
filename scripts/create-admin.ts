/**
 * Creates the first (or any) platform administrator, or resets one's authenticator.
 * Run by whoever operates the deployment, from a machine that has the production
 * DATABASE_URL (for example after `vercel env pull .env.local`). There is deliberately no
 * public sign-up: this command and the "Administrators" screen are the only ways in.
 *
 *   npm run admin:create -- --email you@example.com --name "Your Name"
 *   npm run admin:create -- --reset-mfa --email you@example.com
 *
 * Without a terminal (CI), set ADMIN_BOOTSTRAP_PASSWORD, or omit it to get a one-time
 * password printed once that must be replaced at first sign-in.
 */
import { createAdminAccount, generateTemporaryPassword, resetAdminTwoFactor } from '../server/admin/accounts-service.js'
import { openDatabase } from '../server/db/client.js'
import { createAdminSchema } from '../shared/schemas.js'
import { describeError, loadEnvFiles, parseArgs, promptHidden } from './lib.js'

loadEnvFiles()
const args = parseArgs(process.argv.slice(2))

async function main(): Promise<void> {
  const email = typeof args.get('email') === 'string' ? (args.get('email') as string) : ''
  if (!email) {
    console.error('Usage: npm run admin:create -- --email you@example.com --name "Your Name"')
    console.error('       npm run admin:create -- --reset-mfa --email you@example.com')
    process.exitCode = 2
    return
  }

  const { db, close } = await openDatabase()
  try {
    if (args.get('reset-mfa')) {
      const done = await resetAdminTwoFactor(db, email)
      console.log(
        done
          ? `Two-factor authentication removed for ${email}. They were signed out everywhere and will enrol a new authenticator at next sign-in.`
          : `No administrator with email ${email}.`,
      )
      process.exitCode = done ? 0 : 1
      return
    }

    const name = typeof args.get('name') === 'string' ? (args.get('name') as string) : ''
    const parsed = createAdminSchema.safeParse({ name, email })
    if (!parsed.success) {
      console.error(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('\n'))
      process.exitCode = 2
      return
    }

    let password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? ''
    let chosenByOperator = password !== ''
    if (!password && process.stdin.isTTY) {
      password = await promptHidden('Password (at least 12 characters, leave empty to generate one): ')
      if (password) {
        const again = await promptHidden('Repeat password: ')
        if (again !== password) {
          console.error('Passwords did not match.')
          process.exitCode = 2
          return
        }
        chosenByOperator = true
      }
    }
    const generated = !password
    if (generated) password = generateTemporaryPassword()

    const admin = await createAdminAccount(db, {
      name: parsed.data.name,
      email: parsed.data.email,
      password,
      mustChangePassword: generated || !chosenByOperator,
    })
    console.log(`Created administrator ${admin.name} <${admin.email}>.`)
    if (generated) {
      console.log(`One-time password (shown once, must be changed at first sign-in):\n\n  ${password}\n`)
    }
    console.log('Next: sign in at /admin/login, then set up two-factor authentication when asked.')
  } finally {
    await close()
  }
}

main().catch((error: unknown) => {
  console.error(`Failed: ${describeError(error)}`)
  process.exitCode = 1
})
