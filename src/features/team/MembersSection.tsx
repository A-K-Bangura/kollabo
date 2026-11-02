import type { MemberDto } from '@shared/types'
import { Pencil, RotateCcw, Search, UserMinus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { useProjectScope } from '@/features/scope/useScope'
import { useSessionState } from '@/features/session/sessionState'
import { AddPeople } from './AddPeople'
import { useMemberLookup, useReactivateMember } from './hooks'
import { RemoveDialog, RenameDialog } from './MemberDialogs'

/** Enough people that scrolling gets tedious: offer search. */
const SEARCH_FROM = 8
const PAGE = 50

function matches(member: MemberDto, needle: string): boolean {
  return needle === '' || member.name.toLowerCase().includes(needle)
}

/** The team: search, add (one or many), rename, remove with a decision about their work, and bring people back. */
export function MembersSection() {
  const { members, activeMembers } = useMemberLookup()
  const scope = useProjectScope()
  const reactivate = useReactivateMember()
  const { forgetMember } = useSessionState()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const [renaming, setRenaming] = useState<MemberDto | null>(null)
  const [removing, setRemoving] = useState<MemberDto | null>(null)

  const needle = query.trim().toLowerCase()
  const visible = useMemo(() => activeMembers.filter((member) => matches(member, needle)), [activeMembers, needle])
  const removed = useMemo(
    () => members.filter((member) => !member.isActive && matches(member, needle)),
    [members, needle],
  )
  const shown = visible.slice(0, limit)
  const me = scope.me
  const isAdmin = scope.viewer === 'admin'

  return (
    <section aria-labelledby="members-heading" className="mb-8">
      <h2 id="members-heading" className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Members · {activeMembers.length}
      </h2>

      {activeMembers.length > SEARCH_FROM && (
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setLimit(PAGE)
            }}
            aria-label="Search members"
            placeholder={`Search ${activeMembers.length} people`}
            autoComplete="off"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base transition hover:border-muted/50"
          />
        </div>
      )}

      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {shown.map((member) => (
          <li key={member.id} className="flex items-center gap-1 py-2 pl-4 pr-2">
            <Avatar name={member.name} />
            <span className="ml-2 min-w-0 flex-1 truncate text-base font-medium">
              {member.name}
              {member.id === me?.id && (
                <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-medium text-accent">
                  You
                </span>
              )}
            </span>
            <IconButton label={`Rename ${member.name}`} onClick={() => setRenaming(member)}>
              <Pencil className="size-5" aria-hidden />
            </IconButton>
            <IconButton
              label={`Remove ${member.name}`}
              onClick={() => setRemoving(member)}
              disabled={activeMembers.length <= 1}
            >
              <UserMinus className="size-5" aria-hidden />
            </IconButton>
          </li>
        ))}
        {shown.length === 0 && (
          <li className="px-4 py-5 text-center text-[15px] text-muted">Nobody matches “{query.trim()}”.</li>
        )}
      </ul>

      {visible.length > shown.length && (
        <Button variant="ghost" size="sm" className="mt-2" onClick={() => setLimit((current) => current + PAGE)}>
          Show {Math.min(PAGE, visible.length - shown.length)} more ({visible.length - shown.length} left)
        </Button>
      )}

      <AddPeople />

      {removed.length > 0 && (
        <details className="mt-5">
          <summary className="w-fit cursor-pointer list-none rounded-lg py-1 text-sm font-medium text-muted [&::-webkit-details-marker]:hidden">
            Removed · {removed.length}
          </summary>
          <ul className="mt-2 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            {removed.slice(0, PAGE).map((member) => (
              <li key={member.id} className="flex items-center gap-3 py-2 pl-4 pr-2">
                <Avatar name={member.name} className="opacity-60" />
                <span className="min-w-0 flex-1 truncate text-base text-muted">{member.name}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => reactivate.mutate(member)}
                  disabled={reactivate.isPending}
                  aria-label={`Bring ${member.name} back`}
                >
                  <RotateCcw className="size-4" aria-hidden />
                  Bring back
                </Button>
              </li>
            ))}
          </ul>
          {removed.length > PAGE && (
            <p className="mt-2 text-sm text-muted">Search to find the others.</p>
          )}
        </details>
      )}

      {me && (
        <p className="mt-4 text-sm text-muted">
          Acting as <strong className="font-medium text-ink">{me.name}</strong>.{' '}
          <Link to="/who" className="font-medium text-accent underline-offset-2 hover:underline">
            Not you?
          </Link>
          <span className="mt-1 block">
            Choosing a name tags your changes. It isn’t a login, and nobody’s name is verified.
          </span>
        </p>
      )}
      {isAdmin && (
        <p className="mt-4 text-sm text-muted">
          Changes you make here are recorded in the audit log under your name. Members only see “Collabo admin”.
        </p>
      )}

      <RenameDialog member={renaming} onClose={() => setRenaming(null)} />
      <RemoveDialog
        member={removing}
        onClose={() => setRemoving(null)}
        onRemoved={(member) => {
          if (member.id === me?.id) {
            // You just removed yourself: the app needs to know who is acting again.
            forgetMember()
            void navigate('/who', { replace: true })
          }
        }}
      />
    </section>
  )
}
