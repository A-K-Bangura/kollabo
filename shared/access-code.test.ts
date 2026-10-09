import { describe, expect, it } from 'vitest'
import { formatAccessCodeInput, normalizeAccessCode } from './access-code.js'

describe('normalizeAccessCode', () => {
  it('accepts the canonical form unchanged', () => {
    expect(normalizeAccessCode('K7QM-2XPA-9WTH')).toBe('K7QM-2XPA-9WTH')
  })

  it('forgives case, spaces and missing or odd separators', () => {
    expect(normalizeAccessCode('k7qm-2xpa-9wth')).toBe('K7QM-2XPA-9WTH')
    expect(normalizeAccessCode('  k7qm 2xpa 9wth ')).toBe('K7QM-2XPA-9WTH')
    expect(normalizeAccessCode('K7QM2XPA9WTH')).toBe('K7QM-2XPA-9WTH')
    expect(normalizeAccessCode('K7QM_2XPA.9WTH')).toBe('K7QM-2XPA-9WTH')
  })

  it('rejects wrong lengths', () => {
    expect(normalizeAccessCode('')).toBeNull()
    expect(normalizeAccessCode('K7QM-2XPA')).toBeNull()
    expect(normalizeAccessCode('K7QM-2XPA-9WTH-K7QM')).toBeNull()
  })

  it('rejects look-alike characters that codes never contain', () => {
    for (const bad of ['0', 'O', '1', 'I', 'L']) {
      expect(normalizeAccessCode(`K7Q${bad}-2XPA-9WTH`)).toBeNull()
    }
  })

  it('rejects other punctuation and injection-shaped input', () => {
    expect(normalizeAccessCode('K7QM/2XPA/9WTH')).toBeNull()
    expect(normalizeAccessCode("K7QM-2XPA-9W'; --")).toBeNull()
    expect(normalizeAccessCode('<script>alert(1)</script>')).toBeNull()
  })
})

describe('formatAccessCodeInput', () => {
  it('uppercases, groups with hyphens while typing, and caps the length', () => {
    expect(formatAccessCodeInput('k7')).toBe('K7')
    expect(formatAccessCodeInput('k7qm2')).toBe('K7QM-2')
    expect(formatAccessCodeInput('k7qm-2xpa-9wth-extra')).toBe('K7QM-2XPA-9WTH')
    expect(formatAccessCodeInput('k7 qm!')).toBe('K7QM')
  })
})
