import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { RouterProvider } from 'react-router/dom'
import { toast, Toaster } from 'sonner'
import { SessionProvider } from '@/features/session/SessionProvider'
import { useSessionState } from '@/features/session/sessionState'
import { ApiClientError, isAdminSessionError, isSessionError, isSuspendedError } from '@/lib/api'
import { createQueryClient } from '@/lib/queryClient'
import { useMediaQuery } from '@/lib/useMediaQuery'
import { queryKeys } from '@/lib/queryKeys'
import { router } from './router'

/** Screens that are meant to be seen without a session. */
const PUBLIC_PATHS = new Set(['/', '/new', '/suspended'])

/** Owns the query client so a lost session can reset everything and return to the front door. */
function QueryProvider() {
  const { setRevealedCode } = useSessionState()
  const [queryClient] = useState(createQueryClient)

  useEffect(() => {
    let handling = false

    const onSessionLost = () => {
      // Public screens handle "not signed in" themselves; acting here would loop.
      if (PUBLIC_PATHS.has(router.state.location.pathname)) return
      // Many requests can fail at once when the code is regenerated: react once.
      if (handling) return
      handling = true
      queryClient.clear()
      // The remembered name stays (it is not a credential, and re-entering the
      // same Collabo should not ask again); the in-memory plain code does not.
      setRevealedCode(null)
      toast.error('Your access has ended. Enter the Collabo code again to continue.')
      void router.navigate('/', { replace: true }).finally(() => {
        handling = false
      })
    }

    const onSuspended = () => {
      if (PUBLIC_PATHS.has(router.state.location.pathname)) return
      if (handling) return
      handling = true
      // Nothing from a suspended Collabo should linger on screen; the session itself stays
      // (suspension is temporary), so "Check again" can simply carry on.
      queryClient.clear()
      setRevealedCode(null)
      void router.navigate('/suspended', { replace: true }).finally(() => {
        handling = false
      })
    }

    // An administrator's session ended (signed out elsewhere, expired, deactivated) or their
    // account needs finishing: say so once and go where that can be put right.
    const onAdminProblem = (error: unknown) => {
      const path = router.state.location.pathname
      if (!path.startsWith('/admin') || path === '/admin/login' || handling) return
      const setup =
        error instanceof ApiClientError &&
        (error.code === 'MFA_REQUIRED' || error.code === 'PASSWORD_CHANGE_REQUIRED')
      if (setup && path === '/admin/setup') return
      handling = true
      queryClient.clear()
      if (!setup) toast.error('Your admin session has ended. Sign in again to continue.')
      void router.navigate(setup ? '/admin/setup' : '/admin/login', { replace: true }).finally(() => {
        handling = false
      })
    }
    const isAdminProblem = (error: unknown) =>
      isAdminSessionError(error) ||
      (error instanceof ApiClientError &&
        (error.code === 'MFA_REQUIRED' || error.code === 'PASSWORD_CHANGE_REQUIRED'))

    // Any request that fails because the session is gone (expired, or the code
    // was regenerated) ends up here, whichever screen made it.
    const unsubscribeQueries = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return
      const { error } = event.action
      if (isAdminProblem(error)) {
        // The very first "who am I?" check legitimately says "nobody": the gate handles that itself.
        if (event.query.queryKey.join('/') !== 'admin/me') onAdminProblem(error)
        return
      }
      if (isSuspendedError(error)) {
        // An administrator's view of a suspended Collabo is not an outage for them.
        if (!router.state.location.pathname.startsWith('/admin')) onSuspended()
        return
      }
      if (!isSessionError(error)) return

      // Opening the app with no session at all is normal, not a session being lost.
      const isStartupCheck =
        event.query.queryKey[0] === queryKeys.project[0] &&
        error instanceof ApiClientError &&
        error.code === 'UNAUTHENTICATED'
      if (!isStartupCheck) onSessionLost()
    })

    const unsubscribeMutations = queryClient.getMutationCache().subscribe((event) => {
      if (event.type !== 'updated' || event.action.type !== 'error') return
      if (isAdminProblem(event.action.error)) {
        // Sign-in forms report their own errors; only a mutation inside the admin area ends the session.
        if (router.state.location.pathname !== '/admin/setup') onAdminProblem(event.action.error)
      } else if (isSuspendedError(event.action.error)) {
        if (!router.state.location.pathname.startsWith('/admin')) onSuspended()
      } else if (isSessionError(event.action.error)) {
        onSessionLost()
      }
    })

    return () => {
      unsubscribeQueries()
      unsubscribeMutations()
    }
  }, [queryClient, setRevealedCode])

  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  )
}

/** Bottom-right on desktop so toasts never cover the page title; top on phones, clear of the nav. */
function Notifications() {
  const desktop = useMediaQuery('(min-width: 768px)')
  return (
    <Toaster
      position={desktop ? 'bottom-right' : 'top-center'}
      closeButton={false}
      toastOptions={{ duration: 3500 }}
    />
  )
}

export function App() {
  return (
    <SessionProvider>
      <QueryProvider />
      <Notifications />
    </SessionProvider>
  )
}
