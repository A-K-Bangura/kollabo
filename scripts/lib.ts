import { createInterface } from 'node:readline'

/** Loads .env.local / .env if present (never overrides real environment variables). */
export function loadEnvFiles(): void {
  for (const file of ['.env.local', '.env']) {
    try {
      process.loadEnvFile(file)
    } catch {
      // not present: fine
    }
  }
}

export function parseArgs(argv: readonly string[]): Map<string, string | true> {
  const args = new Map<string, string | true>()
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!
    if (!arg.startsWith('--')) continue
    const [key, inline] = arg.slice(2).split('=', 2)
    if (inline !== undefined) args.set(key!, inline)
    else if (argv[index + 1] && !argv[index + 1]!.startsWith('--')) args.set(key!, argv[(index += 1)]!)
    else args.set(key!, true)
  }
  return args
}

/** Asks for a secret on the terminal without echoing it. */
export function promptHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    const output = rl as unknown as { _writeToOutput: (text: string) => void }
    let asked = false
    output._writeToOutput = (text) => {
      if (!asked) {
        process.stdout.write(text)
        asked = true
      }
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolve(answer)
    })
  })
}

/** A one-line explanation of a failure, including the underlying database error when there is one. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  const cause = error.cause instanceof Error ? ` (${error.cause.message})` : ''
  return `${error.message.split('\n')[0]}${cause}`
}
