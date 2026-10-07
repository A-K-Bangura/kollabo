import { QueryClient } from '@tanstack/react-query'
import { ApiClientError } from './api'

/**
 * Collabo is deliberately manual-refresh: nothing refetches by itself. Data
 * is fetched when a screen first needs it and again only when the person taps
 * "Refresh tasks" or after their own changes. So: never stale (until invalidated
 * by the person's own action), no focus/reconnect refetching, no intervals.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: Infinity,
        gcTime: 30 * 60 * 1000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // Retry once, and only when the request never reached the server.
        retry: (failureCount, error) =>
          error instanceof ApiClientError && error.code === 'NETWORK' && failureCount < 1,
      },
      mutations: { retry: false },
    },
  })
}
