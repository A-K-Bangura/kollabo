import { FolderKanban, LayoutDashboard, LogOut, ScrollText, ShieldCheck, type LucideIcon } from 'lucide-react'
import { NavLink, Navigate, Outlet } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ErrorState, FullScreenLoading } from '@/components/ui/feedback'
import { LogoMark, Wordmark } from '@/components/ui/Logo'
import { ApiClientError, isAdminSessionError } from '@/lib/api'
import { cn } from '@/lib/cn'
import { isSetupComplete, useAdminQuery, useSignOut } from './hooks'

const NAV: { to: string; label: string; icon: LucideIcon; end?: boolean }[] = [
  { to: '/admin', label: 'Overview', icon: LayoutDashboard, end: true },
  { to: '/admin/projects', label: 'Projects', icon: FolderKanban },
  { to: '/admin/audit', label: 'Audit log', icon: ScrollText },
  { to: '/admin/admins', label: 'Admins', icon: ShieldCheck },
]

/** Everything below needs a signed-in administrator; without one, back to the sign-in page. */
export function AdminGate() {
  const me = useAdminQuery()
  if (me.isPending) return <FullScreenLoading />
  if (me.isError) {
    if (isAdminSessionError(me.error) || (me.error instanceof ApiClientError && me.error.code === 'ADMIN_NOT_CONFIGURED')) {
      return <Navigate to="/admin/login" replace />
    }
    return (
      <ErrorState
        className="min-h-dvh justify-center"
        message={me.error.message}
        onRetry={() => void me.refetch()}
      />
    )
  }
  return <Outlet />
}

/** The admin area proper is closed until the administrator has a personal password and two-factor on. */
export function SetupGuard() {
  const me = useAdminQuery()
  if (!me.data) return null
  return isSetupComplete(me.data) ? <Outlet /> : <Navigate to="/admin/setup" replace />
}

export function AdminShell() {
  const me = useAdminQuery()
  const signOut = useSignOut()
  const admin = me.data
  if (!admin) return null

  return (
    <div className="min-h-dvh md:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col gap-6 border-r border-line bg-surface px-4 py-6 md:flex">
        <div className="px-2">
          <Wordmark />
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-semibold uppercase tracking-wide text-warn">
            <ShieldCheck className="size-3.5" aria-hidden />
            Platform admin
          </p>
        </div>

        <nav aria-label="Admin" className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end ?? false}
              className={({ isActive }) =>
                cn(
                  'flex h-11 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition',
                  isActive ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-ink',
                )
              }
            >
              <Icon className="size-5" aria-hidden />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto rounded-xl border border-line p-3">
          <div className="flex items-center gap-3">
            <Avatar name={admin.name} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{admin.name}</p>
              <p className="truncate text-xs text-muted" title={admin.email}>
                {admin.email}
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="mt-3 w-full"
            onClick={() => signOut.mutate()}
            loading={signOut.isPending}
          >
            <LogOut className="size-4" aria-hidden />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur md:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <LogoMark className="size-6" />
            <span className="truncate text-[15px] font-semibold">Admin</span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => signOut.mutate()} loading={signOut.isPending}>
            <LogOut className="size-4" aria-hidden />
            Sign out
          </Button>
        </header>

        <main id="main" className="mx-auto w-full max-w-5xl flex-1 px-4 pb-28 pt-5 md:px-8 md:pb-16 md:pt-10">
          <Outlet />
        </main>
      </div>

      <nav
        aria-label="Admin"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end ?? false}
            className={({ isActive }) =>
              cn(
                'flex min-h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition',
                isActive ? 'text-accent' : 'text-muted',
              )
            }
          >
            <Icon className="size-6" aria-hidden />
            {label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
