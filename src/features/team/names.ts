import { LIMITS } from '@shared/constants'

export interface ParsedNames {
  /** Clean, de-duplicated (ignoring case), in the order they were written. */
  names: string[]
  /** Entries dropped because they are too long to be a name. */
  tooLong: string[]
  /** Names repeated in the pasted text itself. */
  duplicates: string[]
}

/**
 * Turns pasted text into a list of names: one per line, or separated by commas or
 * semicolons (so a column copied from a spreadsheet and a typed list both work).
 */
export function parseNameList(text: string): ParsedNames {
  const seen = new Set<string>()
  const names: string[] = []
  const tooLong: string[] = []
  const duplicates: string[] = []

  for (const raw of text.split(/[\n\r,;]+/)) {
    const name = raw.replace(/\s+/g, ' ').trim()
    if (!name) continue
    if (name.length > LIMITS.personName) {
      tooLong.push(name)
      continue
    }
    const key = name.toLowerCase()
    if (seen.has(key)) {
      duplicates.push(name)
      continue
    }
    seen.add(key)
    names.push(name)
  }
  return { names, tooLong, duplicates }
}
