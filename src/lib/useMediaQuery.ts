import { useSyncExternalStore } from 'react'

/** Tracks a CSS media query (e.g. '(min-width: 768px)') and re-renders when it flips. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}
