import { zodResolver } from '@hookform/resolvers/zod'
import { personNameSchema } from '@shared/schemas'
import { Search, UserPlus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router'
import { z } from 'zod'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { ErrorState, Skeleton } from '@/components/ui/feedback'
import { TextField } from '@/components/ui/fields'
import { useAddMember, useMembersQuery } from '@/features/team/hooks'
import { cn } from '@/lib/cn'
import { useCurrentProject } from './context'
import { useLeaveCollabo } from './hooks'
import { useSessionState } from './sessionState'

const nameSchema = z.object({ name: personNameSchema })

/** Large teams: search, and draw the list in pages. */
const PAGE = 50
const SEARCH_FROM = 8

/**
 * "Who are you?" tags your changes with your name. It is attribution between
 * people who trust each other, not a login, and the screen says so.
 */
export function WhoAreYouPage() {
  const project = useCurrentProject()
  const members = useMembersQuery()
  const { selection, selectMember } = useSessionState()
  const navigate = useNavigate()
  const add = useAddMember()
  const leave = useLeaveCollabo()
  const [picked, setPicked] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const active = members.data?.filter((member) => member.isActive) ?? []
  const needle = query.trim().toLowerCase()
  const matching = needle ? active.filter((member) => member.name.toLowerCase().includes(needle)) : active
  const visible = matching.slice(0, limit)
  const remembered = selection?.projectId === project.id ? selection.memberId : null
  const chosen = picked ?? (active.some((member) => member.id === remembered) ? remembered : null)

  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  })

  const addMe = form.handleSubmit(({ name }) => {
    add.mutate(name, {
      onSuccess: (member) => {
        setPicked(member.id)
        setAdding(false)
        form.reset()
      },
    })
  })

  const proceed = () => {
    if (!chosen) return
    selectMember(project.id, chosen)
    void navigate('/today', { replace: true })
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-6 py-12">
      <p className="text-sm text-muted">Welcome to</p>
      <h1 className="text-2xl font-semibold tracking-tight [overflow-wrap:anywhere]">{project.name}</h1>
      <h2 className="mt-8 text-lg font-medium">Who are you?</h2>
      <p className="mt-1 text-sm text-muted">
        This just puts your name on what you change. It isn’t a login, and nobody’s name is checked: anyone with the code could pick any name.
      </p>

      <div className="mt-5">
        {members.isPending && (
          <div role="status" aria-label="Loading team" className="space-y-2">
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
            <Skeleton className="h-14" />
          </div>
        )}
        {members.isError && (
          <ErrorState message={members.error.message} onRetry={() => void members.refetch()} />
        )}
        {members.isSuccess && (
          <fieldset>
            <legend className="sr-only">Choose your name</legend>
            {active.length > SEARCH_FROM && (
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
                <input
                  type="search"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value)
                    setLimit(PAGE)
                  }}
                  aria-label="Search names"
                  placeholder={`Search ${active.length} people`}
                  autoComplete="off"
                  className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base transition hover:border-muted/50"
                />
              </div>
            )}
            <ul className="space-y-2">
              {visible.map((member) => (
                <li key={member.id}>
                  <label className="relative block">
                    <input
                      type="radio"
                      name="member"
                      value={member.id}
                      checked={chosen === member.id}
                      onChange={() => setPicked(member.id)}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        'flex h-14 items-center gap-3 rounded-2xl border border-line bg-surface px-4 text-base font-medium transition',
                        'hover:border-muted/50 peer-checked:border-accent peer-checked:bg-accent-soft',
                        'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                      )}
                    >
                      <Avatar name={member.name} />
                      <span className="truncate">{member.name}</span>
                    </span>
                  </label>
                </li>
              ))}
              {visible.length === 0 && (
                <li className="py-4 text-center text-sm text-muted">Nobody matches “{query.trim()}”.</li>
              )}
            </ul>
            {matching.length > visible.length && (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit((current) => current + PAGE)}>
                Show more ({matching.length - visible.length} left)
              </Button>
            )}
          </fieldset>
        )}
      </div>

      {members.isSuccess &&
        (adding ? (
          <form onSubmit={addMe} noValidate className="mt-4 flex items-start gap-2">
            <div className="flex-1">
              <TextField
                label="Your name"
                autoFocus
                autoComplete="given-name"
                error={form.formState.errors.name?.message}
                {...form.register('name')}
              />
            </div>
            <Button type="submit" loading={add.isPending} className="mt-7">
              Add
            </Button>
          </form>
        ) : (
          <Button variant="ghost" className="mt-3" onClick={() => setAdding(true)}>
            <UserPlus className="size-4" aria-hidden />
            Add my name
          </Button>
        ))}

      <Button size="lg" className="mt-8 w-full" disabled={!chosen} onClick={proceed}>
        Continue
      </Button>

      <p className="mt-8 text-center text-sm text-muted">
        Wrong Collabo?{' '}
        <button
          type="button"
          onClick={() => leave.mutate()}
          disabled={leave.isPending}
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          Leave it
        </button>
      </p>
    </main>
  )
}
