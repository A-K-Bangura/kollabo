import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { SessionContext, type Selection, type SessionState } from './sessionState'

const STORAGE_KEY = 'collabo:member'

function readSelection(): Selection | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (
      typeof value === 'object' &&
      value !== null &&
      typeof (value as Selection).projectId === 'string' &&
      typeof (value as Selection).memberId === 'string'
    ) {
      return { projectId: (value as Selection).projectId, memberId: (value as Selection).memberId }
    }
  } catch {
    // Storage can be unavailable or corrupted; behave as if nothing was remembered.
  }
  return null
}

function writeSelection(selection: Selection | null): void {
  try {
    if (selection) localStorage.setItem(STORAGE_KEY, JSON.stringify(selection))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Not remembering is fine: the person just picks their name again next time.
  }
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [selection, setSelection] = useState<Selection | null>(readSelection)
  const [revealedCode, setRevealedCode] = useState<string | null>(null)

  const selectMember = useCallback((projectId: string, memberId: string) => {
    const next = { projectId, memberId }
    writeSelection(next)
    setSelection(next)
  }, [])

  const forgetMember = useCallback(() => {
    writeSelection(null)
    setSelection(null)
  }, [])

  const reset = useCallback(() => {
    writeSelection(null)
    setSelection(null)
    setRevealedCode(null)
  }, [])

  const value = useMemo<SessionState>(
    () => ({ selection, revealedCode, selectMember, forgetMember, setRevealedCode, reset }),
    [selection, revealedCode, selectMember, forgetMember, reset],
  )

  return <SessionContext value={value}>{children}</SessionContext>
}
