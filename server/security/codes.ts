import { createHmac, randomInt, timingSafeEqual } from 'node:crypto'
import {
  CODE_ALPHABET,
  CODE_GROUP_LENGTH,
  CODE_GROUPS,
} from '../../shared/access-code.js'
import { getEnv } from '../env.js'

/** A fresh access code from the OS CSPRNG (`randomInt` is unbiased). */
export function generateAccessCode(): string {
  const groups: string[] = []
  for (let group = 0; group < CODE_GROUPS; group += 1) {
    let chars = ''
    for (let index = 0; index < CODE_GROUP_LENGTH; index += 1) {
      chars += CODE_ALPHABET.charAt(randomInt(CODE_ALPHABET.length))
    }
    groups.push(chars)
  }
  return groups.join('-')
}

/**
 * Keyed hash of a canonical access code (see normalizeAccessCode).
 *
 * The code has to be findable from the code alone, so a per-row salt is not an
 * option; instead it is an HMAC under a server-side pepper. A database leak
 * therefore reveals nothing guessable, and the codes themselves carry ~59 bits
 * of entropy, which is why a fast hash is appropriate here (unlike passwords).
 */
export function hashAccessCode(code: string): string {
  return createHmac('sha256', getEnv().ACCESS_CODE_PEPPER)
    .update(`collabo:access-code:v1:${code}`)
    .digest('hex')
}

/** Constant-time comparison of two hex digests. */
export function digestsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right)
}
