import type { AdminProfileDto } from '@shared/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { adminApi } from '@/lib/adminApi'

export const adminKeys = {
  me: ['admin', 'me'] as const,
  overview: ['admin', 'overview'] as const,
  projects: ['admin', 'projects'] as const,
  project: (id: string) => ['admin', 'project-summary', id] as const,
  audit: ['admin', 'audit'] as const,
  admins: ['admin', 'admins'] as const,
}

/** Who is signed in as an administrator, or why not (401 not signed in, 403 setup unfinished). */
export function useAdminQuery() {
  return useQuery({ queryKey: adminKeys.me, queryFn: adminApi.me, retry: false })
}

/** Setup is finished once a personal password is chosen and two-factor is on. */
export function isSetupComplete(admin: AdminProfileDto): boolean {
  return !admin.mustChangePassword && admin.twoFactorEnabled
}

export function useSignOut() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: adminApi.signOut,
    onSuccess: () => {
      // This browser is done: forget everything it learned as an administrator.
      queryClient.clear()
      void navigate('/admin/login', { replace: true })
    },
    // Not signed out until the server says so: pretending otherwise would leave a live session behind.
    onError: (error) => toast.error(`Couldn’t sign out: ${error.message}`),
  })
}
