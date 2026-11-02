import { createHmac } from 'node:crypto'
import { createAdminAccount } from '../admin/accounts-service.js'
import type { Database } from '../db/client.js'
import { TestClient, type ApiResult, type SendOptions } from './client.js'

export const ADMIN_PASSWORD = 'correct horse battery staple'
export const ORIGIN = 'https://collabo.test'

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
function base32Decode(input: string): Buffer {
  let bits = ''
  for (const char of input.toUpperCase()) bits += ALPHABET.indexOf(char).toString(2).padStart(5, '0')
  const bytes: number[] = []
  for (let index = 0; index + 8 <= bits.length; index += 8) bytes.push(parseInt(bits.slice(index, index + 8), 2))
  return Buffer.from(bytes)
}

/** A current RFC 6238 code for the secret in an `otpauth://` link, as an authenticator app would show. */
export function totpFor(totpURI: string, offsetSteps = 0): string {
  const secret = new URL(totpURI).searchParams.get('secret')
  if (!secret) throw new Error('No secret in otpauth link')
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps))
  const hash = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = hash[hash.length - 1]! & 0xf
  const value =
    (((hash[offset]! & 0x7f) << 24) | (hash[offset + 1]! << 16) | (hash[offset + 2]! << 8) | hash[offset + 3]!) %
    1_000_000
  return String(value).padStart(6, '0')
}

/** One administrator's browser. Like a real one, it sends its own origin with every write. */
export class AdminClient extends TestClient {
  totpURI: string | null = null
  backupCodes: string[] = []

  readonly email: string
  readonly password: string

  constructor(email: string, password: string = ADMIN_PASSWORD) {
    super()
    this.email = email
    this.password = password
  }

  override send<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    options: SendOptions = {},
  ): Promise<ApiResult<T>> {
    return super.send<T>(method, path, { ...options, headers: { origin: ORIGIN, ...options.headers } })
  }

  /** Password step only. */
  signIn(password: string = this.password) {
    return this.post<{ twoFactorRequired: boolean }>('/api/auth/sign-in/email', {
      body: { email: this.email, password },
    })
  }

  /** Starts enrollment on a signed-in session and keeps the secret, like scanning the QR code would. */
  async startEnrollment(password: string = this.password) {
    const result = await this.post<{ totpURI: string; backupCodes: string[] }>(
      '/api/auth/two-factor/enable',
      { body: { password } },
    )
    if (result.status === 200) {
      this.totpURI = result.body.totpURI
      this.backupCodes = result.body.backupCodes
    }
    return result
  }

  verifyCode(code: string) {
    return this.post<{ enrolled: boolean }>('/api/auth/two-factor/verify-totp', { body: { code } })
  }

  /** Signs in and, if needed, enrolls, ending fully authenticated. */
  async signInFully(): Promise<this> {
    const first = await this.signIn()
    if (first.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(first.body)}`)
    if (first.body.twoFactorRequired) {
      if (!this.totpURI) throw new Error('This client has no authenticator secret')
      const second = await this.verifyCode(totpFor(this.totpURI))
      if (second.status !== 200) throw new Error(`2FA failed: ${JSON.stringify(second.body)}`)
      return this
    }
    const started = await this.startEnrollment()
    if (started.status !== 200) throw new Error(`enrollment failed: ${JSON.stringify(started.body)}`)
    const done = await this.verifyCode(totpFor(this.totpURI!))
    if (done.status !== 200) throw new Error(`enrollment verify failed: ${JSON.stringify(done.body)}`)
    return this
  }

  /** The same browser later: forgets its cookies but still holds its authenticator. */
  newBrowser(): AdminClient {
    const next = new AdminClient(this.email, this.password)
    next.totpURI = this.totpURI
    next.backupCodes = [...this.backupCodes]
    return next
  }
}

let counter = 0

/** Creates an administrator directly in the database (as the bootstrap script does). */
export async function createTestAdmin(
  db: Database,
  options: { name?: string; mustChangePassword?: boolean; password?: string } = {},
): Promise<AdminClient> {
  counter += 1
  const email = `admin${counter}-${Math.random().toString(36).slice(2, 8)}@example.com`
  const password = options.password ?? ADMIN_PASSWORD
  await createAdminAccount(db, {
    name: options.name ?? `Admin ${counter}`,
    email,
    password,
    mustChangePassword: options.mustChangePassword ?? false,
  })
  return new AdminClient(email, password)
}

/** An administrator who has finished setup and is signed in. */
export async function signedInAdmin(db: Database, name?: string): Promise<AdminClient> {
  const admin = await createTestAdmin(db, { name })
  return admin.signInFully()
}
