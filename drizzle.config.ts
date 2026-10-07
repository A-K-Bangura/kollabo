import { defineConfig } from 'drizzle-kit'

// drizzle-kit does not read .env files on its own. Load them the same way the
// Vercel CLI names them (.env.local from `vercel env pull`, then .env).
for (const file of ['.env.local', '.env']) {
  try {
    process.loadEnvFile(file)
  } catch {
    // The file is optional; DATABASE_URL may come from the real environment.
  }
}

const url = process.env.DATABASE_URL

export default defineConfig({
  dialect: 'postgresql',
  schema: './server/db/schema.ts',
  out: './server/db/migrations',
  // `generate` works offline; `migrate` and `studio` need DATABASE_URL.
  ...(url ? { dbCredentials: { url } } : {}),
})
