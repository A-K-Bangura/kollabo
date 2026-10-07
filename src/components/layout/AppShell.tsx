import { CalendarDays, ListChecks, Plus, Sun, Users, type LucideIcon } from 'lucide-react'
import { Link, NavLink, Outlet, useLocation } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { LogoMark, Wordmark } from '@/components/ui/Logo'
import { useCurrentMember, useCurrentProject } from '@/features/session/context'
import { TaskSheet } from '@/features/tasks/TaskSheet'
import { useTaskSheet } from '@/features/tasks/useTaskSheet'
import { cn } from '@/lib/cn'

const NAV: { to: string; label: string; icon: LucideIcon }[] = [
  { to: '/today', label: 'Today', icon: Sun },
  { to: '/tasks', label: 'Tasks', icon: ListChecks },
  { to: '/calendar', label: 'Calendar', icon: CalendarDays },
  { to: '/team', label: 'Team', icon: Users },
]

/** Desktop: a calm sidebar. Phone: a bottom bar with a floating "new task" button. */
export function AppShell() {
  const project = useCurrentProject()
  const member = useCurrentMember()
  const { openNew } = useTaskSheet()
  // The floating button belongs on the task lists. Calendar has its own date-aware
  // "Add task", and Team has no tasks to add to.
  const { pathname } = useLocation()
  const showNewTaskButton = pathname === '/today' || pathname === '/tasks'

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
          <p className="mt-3 truncate text-sm text-muted" title={project.name}>
            {project.name}
          </p>
        </div>

        <Button onClick={() => openNew()} className="w-full">
          <Plus className="size-4" aria-hidden />
          New task
        </Button>

        <nav aria-label="Main" className="flex flex-col gap-1">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
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

        <div className="mt-auto flex items-center gap-3 rounded-xl border border-line p-3">
          <Avatar name={member.name} />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">You are</p>
            <p className="truncate text-sm font-medium">{member.name}</p>
          </div>
          <Link
            to="/who"
            className="rounded-lg px-2 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
          >
            Switch
          </Link>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur md:hidden">
          <span className="flex min-w-0 items-center gap-2">
            <LogoMark className="size-6" />
            <span className="truncate text-[15px] font-semibold">{project.name}</span>
          </span>
          <Link to="/team" aria-label={`You are ${member.name}. Open Team`}>
            <Avatar name={member.name} className="size-8" />
          </Link>
        </header>

        <main
          id="main"
          className="mx-auto w-full max-w-3xl flex-1 px-4 pb-44 pt-5 md:px-8 md:pb-16 md:pt-10"
        >
          <Outlet />
        </main>
      </div>

      {showNewTaskButton && (
        <button
          type="button"
          onClick={() => openNew()}
          aria-label="New task"
          className="fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] right-4 z-20 flex size-14 items-center justify-center rounded-full bg-accent text-accent-ink shadow-lg transition active:scale-95 md:hidden"
        >
          <Plus className="size-6" aria-hidden />
        </button>
      )}

      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-20 grid grid-cols-4 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
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

      <TaskSheet />
    </div>
  )
}
