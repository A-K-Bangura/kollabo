/**
 * Access codes look like `K7QM-2XPA-9WTH`: three groups of four characters drawn
 * from a 31-symbol alphabet with no look-alikes (no 0/O, 1/I/L). That is about
 * 59 bits of entropy, which keeps online guessing impractical even before rate
 * limiting. Shared by the server (generation, validation) and the browser
 * (input formatting).
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'
export const CODE_GROUPS = 3
export const CODE_GROUP_LENGTH = 4
export const CODE_LENGTH = CODE_GROUPS * CODE_GROUP_LENGTH
export const CODE_EXAMPLE = 'K7QM-2XPA-9WTH'

const SEPARATORS = /[\s\-_.]/g
const VALID_COMPACT = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`)

function groupCode(compact: string): string {
  const groups: string[] = []
  for (let index = 0; index < compact.length; index += CODE_GROUP_LENGTH) {
    groups.push(compact.slice(index, index + CODE_GROUP_LENGTH))
  }
  return groups.join('-')
}

/**
 * Canonicalises what a person typed or pasted: case, spaces and separators are
 * forgiven. Returns null unless the result is a well-formed code.
 */
export function normalizeAccessCode(input: string): string | null {
  const compact = input.toUpperCase().replace(SEPARATORS, '')
  return VALID_COMPACT.test(compact) ? groupCode(compact) : null
}

/** Live-formats the code field while typing: uppercase, grouped, length-capped. */
export function formatAccessCodeInput(input: string): string {
  const compact = input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, CODE_LENGTH)
  return groupCode(compact)
}
