import { zodResolver } from '@hookform/resolvers/zod'
import { personNameSchema } from '@shared/schemas'
import type { MemberDto } from '@shared/types'
import { UserMinus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { z } from 'zod'
import { Avatar } from '@/components/ui/Avatar'
import { Button, IconButton } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/ui/Dialog'
import { TextField } from '@/components/ui/fields'
import { useCurrentMember } from '@/features/session/context'
import { useSessionState } from '@/features/session/sessionState'
import { useAddMember, useMemberLookup, useRemoveMember } from './hooks'

const nameSchema = z.object({ name: personNameSchema })

export function MembersSection() {
  const { activeMembers } = useMemberLookup()
  const me = useCurrentMember()
  const add = useAddMember()
  const remove = useRemoveMember()
  const { forgetMember } = useSessionState()
  const navigate = useNavigate()
  const [removing, setRemoving] = useState<MemberDto | null>(null)

  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  })

  const addMember = form.handleSubmit(({ name }) => {
    add.mutate(name, { onSuccess: () => form.reset() })
  })

  const confirmRemove = () => {
    if (!removing) return
    const removingMyself = removing.id === me.id
    remove.mutate(removing, {
      onSuccess: () => {
        setRemoving(null)
        if (removingMyself) {
          // You just removed yourself: the app needs to know who is acting again.
          forgetMember()
          void navigate('/who', { replace: true })
        }
      },
    })
  }

  return (
    <section aria-labelledby="members-heading" className="mb-8">
      <h2 id="members-heading" className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        Members · {activeMembers.length}
      </h2>

      <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {activeMembers.map((member) => (
          <li key={member.id} className="flex items-center gap-3 px-4 py-2.5">
            <Avatar name={member.name} />
            <span className="min-w-0 flex-1 truncate text-base font-medium">
              {member.name}
              {member.id === me.id && (
                <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 align-middle text-xs font-medium text-accent">
                  You
                </span>
              )}
            </span>
            <IconButton
              label={`Remove ${member.name}`}
              onClick={() => setRemoving(member)}
              disabled={activeMembers.length <= 1}
            >
              <UserMinus className="size-5" aria-hidden />
            </IconButton>
          </li>
        ))}
      </ul>

      <form onSubmit={addMember} noValidate className="mt-4 flex items-start gap-2">
        <div className="flex-1">
          <TextField
            label="Add a teammate"
            placeholder="Name"
            autoComplete="off"
            error={form.formState.errors.name?.message}
            {...form.register('name')}
          />
        </div>
        <Button type="submit" loading={add.isPending} className="mt-7">
          Add
        </Button>
      </form>

      <p className="mt-4 text-sm text-muted">
        Acting as <strong className="font-medium text-ink">{me.name}</strong>.{' '}
        <Link to="/who" className="font-medium text-accent underline-offset-2 hover:underline">
          Not you?
        </Link>
      </p>

      <ConfirmDialog
        open={removing !== null}
        onClose={() => setRemoving(null)}
        title={removing ? `Remove ${removing.name}?` : ''}
        description="Their tasks and history stay exactly as they are. They just won’t be offered for new work."
        confirmLabel="Remove"
        loading={remove.isPending}
        onConfirm={confirmRemove}
      />
    </section>
  )
}
