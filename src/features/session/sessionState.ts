import { createContext, useContext } from 'react'

/**
 * Who is using this browser, and the one moment the access code is visible.
 *
 * Choosing a member is attribution, not authentication: it is remembered in
 * localStorage for convenience and is deliberately not a login. The plain
 * access code only ever lives in memory here (from create/regenerate until the
 * page reloads); it is never written to storage because the server keeps only
 * a hash.
 */
export interface Selection {
  projectId: string
  memberId: string
}

export interface SessionState {
  selection: Selection | null
  revealedCode: string | null
  selectMember: (projectId: string, memberId: string) => void
  forgetMember: () => void
  setRevealedCode: (code: string | null) => void
  /** Forget everything about the current Collabo (on leave or when access is lost). */
  reset: () => void
}

export const SessionContext = createContext<SessionState | null>(null)

export function useSessionState(): SessionState {
  const context = useContext(SessionContext)
  if (!context) throw new Error('useSessionState must be used inside <SessionProvider>')
  return context
}
