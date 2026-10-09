import { useEffect, useState } from 'react'

/**
 * A clock that re-renders its component every `intervalMs`. This only keeps
 * labels such as "2 minutes ago" and "Today" honest; it never touches the network.
 */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
