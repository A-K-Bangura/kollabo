import { zodResolver } from '@hookform/resolvers/zod'
import { LIMITS } from '@shared/constants'
import { personNameSchema } from '@shared/schemas'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/fields'
import { useAddMember, useAddMembers } from './hooks'
import { parseNameList } from './names'

const nameSchema = z.object({ name: personNameSchema })

/** One name, or a pasted list. The team has no size limit; one request just takes up to a couple of hundred names. */
export function AddPeople() {
  const add = useAddMember()
  const addMany = useAddMembers()
  const [bulk, setBulk] = useState(false)
  const [text, setText] = useState('')

  const form = useForm<z.infer<typeof nameSchema>>({
    resolver: zodResolver(nameSchema),
    defaultValues: { name: '' },
  })

  const addOne = form.handleSubmit(({ name }) => {
    add.mutate(name, { onSuccess: () => form.reset() })
  })

  const parsed = parseNameList(text)
  const tooMany = parsed.names.length > LIMITS.membersPerRequest
  const problem =
    parsed.tooLong.length > 0
      ? `“${parsed.tooLong[0]!.slice(0, 20)}…” is too long to be a name.`
      : tooMany
        ? `Add up to ${LIMITS.membersPerRequest} people at a time.`
        : undefined

  const submitMany = () => {
    if (parsed.names.length === 0 || problem) return
    addMany.mutate(parsed.names, {
      onSuccess: (result) => {
        const added = result.members.length
        const skipped = result.skipped.length
        toast.success(
          skipped > 0
            ? `Added ${added}. ${skipped} already ${skipped === 1 ? 'was' : 'were'} here: ${result.skipped.slice(0, 3).join(', ')}${skipped > 3 ? '…' : ''}`
            : `Added ${added} ${added === 1 ? 'person' : 'people'}`,
        )
        setText('')
        if (skipped === 0) setBulk(false)
      },
    })
  }

  return (
    <div className="mt-4">
      {bulk ? (
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submitMany()
          }}
          className="flex flex-col gap-3"
        >
          <TextAreaField
            label="Add several people"
            hint="One name per line, or separated by commas. Paste a whole list if you have one."
            rows={5}
            autoFocus
            value={text}
            onChange={(event) => setText(event.target.value)}
            error={problem}
          />
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" onClick={() => setBulk(false)}>
              Add one at a time
            </Button>
            <Button type="submit" loading={addMany.isPending} disabled={parsed.names.length === 0 || !!problem}>
              {parsed.names.length > 0
                ? `Add ${parsed.names.length} ${parsed.names.length === 1 ? 'person' : 'people'}`
                : 'Add people'}
            </Button>
          </div>
        </form>
      ) : (
        <>
          <form onSubmit={addOne} noValidate className="flex items-start gap-2">
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
          <Button variant="ghost" size="sm" className="mt-1" onClick={() => setBulk(true)}>
            Add several at once
          </Button>
        </>
      )}
    </div>
  )
}
