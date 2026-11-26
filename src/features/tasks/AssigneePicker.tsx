import type { MemberDto } from '@shared/types'
import { Check, Search, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/cn'

/** How many people are drawn at once. Teams can be large; the rest are one search or "Show more" away. */
const PAGE = 100
const CHIPS = 6

interface AssigneePickerProps {
  /** The whole team, including removed members (so an existing assignee who was removed stays visible). */
  members: readonly MemberDto[]
  value: readonly string[]
  onChange: (ids: string[]) => void
  error?: string | undefined
  disabled?: boolean
}

/**
 * Choose the people a task is for. Built for any team size: search by name, pick one by
 * one, or take everyone (or everyone matching the search) in a tap. Selection order is
 * kept, because the first person chosen is shown first on the task.
 */
export function AssigneePicker({ members, value, onChange, error, disabled }: AssigneePickerProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(PAGE)

  const selected = useMemo(() => new Set(value), [value])
  const byId = useMemo(() => new Map(members.map((member) => [member.id, member])), [members])

  // Active people can be added; a removed person who already holds the task stays listed so it can be unticked.
  const candidates = useMemo(
    () => members.filter((member) => member.isActive || selected.has(member.id)),
    [members, selected],
  )
  const needle = query.trim().toLowerCase()
  const matches = useMemo(
    () => (needle ? candidates.filter((member) => member.name.toLowerCase().includes(needle)) : candidates),
    [candidates, needle],
  )
  const shown = matches.slice(0, limit)
  const selectable = matches.filter((member) => member.isActive)
  const allShownSelected = selectable.length > 0 && selectable.every((member) => selected.has(member.id))

  const toggle = (memberId: string) =>
    onChange(selected.has(memberId) ? value.filter((existing) => existing !== memberId) : [...value, memberId])

  const selectShown = () => {
    const additions = selectable.map((member) => member.id).filter((memberId) => !selected.has(memberId))
    onChange([...value, ...additions])
  }

  const deselectShown = () => {
    const drop = new Set(matches.map((member) => member.id))
    onChange(value.filter((memberId) => !drop.has(memberId)))
  }

  const chips = value.slice(0, CHIPS)
  const label = needle
    ? `${selectable.length} ${selectable.length === 1 ? 'match' : 'matches'}`
    : `everyone (${selectable.length})`

  return (
    <div role="group" aria-labelledby={`${id}-label`} className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={`${id}-label`} className="text-sm font-medium">
          Assign to
        </span>
        <span aria-live="polite" className="text-sm text-muted">
          {value.length === 0 ? 'Nobody yet' : `${value.length} selected`}
        </span>
      </div>

      {value.length > 0 && (
        <ul aria-label="Selected people" className="flex flex-wrap gap-1.5">
          {chips.map((memberId) => {
            const member = byId.get(memberId)
            return (
              <li key={memberId}>
                <button
                  type="button"
                  onClick={() => toggle(memberId)}
                  disabled={disabled}
                  aria-label={`Remove ${member?.name ?? 'person'} from this task`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-full bg-accent-soft pl-3 pr-2 text-sm font-medium text-accent transition hover:opacity-80 disabled:opacity-60"
                >
                  <span className="max-w-32 truncate">{member?.name ?? 'Someone'}</span>
                  <X className="size-3.5" aria-hidden />
                </button>
              </li>
            )
          })}
          {value.length > CHIPS && (
            <li className="inline-flex h-8 items-center px-1 text-sm text-muted">
              +{value.length - CHIPS} more
            </li>
          )}
        </ul>
      )}

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setLimit(PAGE)
          }}
          disabled={disabled}
          placeholder={`Search ${candidates.length} ${candidates.length === 1 ? 'person' : 'people'}`}
          aria-label="Search people"
          autoComplete="off"
          className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-base text-ink transition hover:border-muted/50"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {allShownSelected ? (
          <Button size="sm" variant="secondary" onClick={deselectShown} disabled={disabled}>
            {needle ? 'Unselect these' : 'Unselect everyone'}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={selectShown} disabled={disabled || selectable.length === 0}>
            Select {label}
          </Button>
        )}
        {value.length > 0 && !allShownSelected && (
          <Button size="sm" variant="ghost" onClick={() => onChange([])} disabled={disabled}>
            Clear
          </Button>
        )}
      </div>

      <ul
        aria-label="People"
        className="max-h-64 divide-y divide-line overflow-y-auto overscroll-contain rounded-xl border border-line"
      >
        {shown.map((member) => {
          const checked = selected.has(member.id)
          return (
            <li key={member.id}>
              <label
                className={cn(
                  'flex min-h-12 cursor-pointer items-center gap-3 px-3 py-1.5 transition hover:bg-raised/60',
                  checked && 'bg-accent-soft/50',
                )}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(member.id)}
                  disabled={disabled || (!member.isActive && !checked)}
                  className="peer sr-only"
                />
                <span
                  aria-hidden
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-md border transition',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                    checked ? 'border-accent bg-accent text-accent-ink' : 'border-line bg-surface',
                  )}
                >
                  {checked && <Check className="size-3.5" strokeWidth={3} />}
                </span>
                <Avatar name={member.name} className="size-7 text-xs" />
                <span className="min-w-0 flex-1 truncate text-[15px]">
                  {member.name}
                  {!member.isActive && <span className="ml-1.5 text-muted">(removed)</span>}
                </span>
              </label>
            </li>
          )
        })}
        {shown.length === 0 && (
          <li className="px-3 py-4 text-center text-sm text-muted">Nobody matches “{query.trim()}”.</li>
        )}
      </ul>

      {matches.length > shown.length && (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setLimit((current) => current + PAGE)}>
          Show {Math.min(PAGE, matches.length - shown.length)} more of {matches.length - shown.length}
        </Button>
      )}

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
