import { describe, expect, it } from 'vitest'
import { CODE_ALPHABET, normalizeAccessCode } from '../../shared/access-code.js'
import { digestsMatch, generateAccessCode, hashAccessCode } from './codes.js'

describe('generateAccessCode', () => {
  it('produces well-formed codes that survive normalisation unchanged', () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateAccessCode()
      expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/)
      expect(normalizeAccessCode(code)).toBe(code)
    }
  })

  it('never uses look-alike characters', () => {
    const joined = Array.from({ length: 500 }, generateAccessCode).join('')
    expect(joined).not.toMatch(/[01OIL]/)
  })

  it('does not repeat and uses the whole alphabet (no sequential or biased output)', () => {
    const codes = Array.from({ length: 3000 }, generateAccessCode)
    expect(new Set(codes).size).toBe(codes.length)

    const seen = new Set(codes.join('').replaceAll('-', ''))
    expect([...CODE_ALPHABET].filter((char) => !seen.has(char))).toEqual([])
  })
})

describe('hashAccessCode', () => {
  it('is a deterministic 256-bit digest of the code', () => {
    const code = 'K7QM-2XPA-9WTH'
    expect(hashAccessCode(code)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashAccessCode(code)).toBe(hashAccessCode(code))
  })

  it('differs for different codes and never contains the code itself', () => {
    const hash = hashAccessCode('K7QM-2XPA-9WTH')
    expect(hash).not.toBe(hashAccessCode('K7QM-2XPA-9WTJ'))
    expect(hash.toLowerCase()).not.toContain('k7qm')
  })
})

describe('digestsMatch', () => {
  it('compares digests, rejecting mismatches and malformed input', () => {
    const hash = hashAccessCode('K7QM-2XPA-9WTH')
    expect(digestsMatch(hash, hash)).toBe(true)
    expect(digestsMatch(hash, hashAccessCode('K7QM-2XPA-9WTJ'))).toBe(false)
    expect(digestsMatch(hash, hash.slice(0, 62))).toBe(false)
    expect(digestsMatch('', '')).toBe(false)
  })
})
