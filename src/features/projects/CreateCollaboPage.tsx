import { zodResolver } from '@hookform/resolvers/zod'
import { LIMITS } from '@shared/constants'
import { personNameSchema, projectNameSchema } from '@shared/schemas'
import type { CreateProjectResponse } from '@shared/types'
import { ArrowLeft, Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link, useNavigate } from 'react-router'
import { toast } from 'sonner'
import { z } from 'zod'
import { Button } from '@/components/ui/Button'
import { TextAreaField, TextField } from '@/components/ui/fields'
import { parseNameList } from '@/features/team/names'
import { useCreateProject, useReportError } from '@/features/session/hooks'
import { copyToClipboard } from '@/lib/clipboard'

const formSchema = z.object({
  name: projectNameSchema,
  creatorName: personNameSchema,
  /** Pasted or typed: one name per line, or separated by commas. */
  teammates: z.string().superRefine((text, context) => {
    const { names, tooLong } = parseNameList(text)
    if (tooLong.length > 0) {
      context.addIssue({
        code: 'custom',
        message: `“${tooLong[0]!.slice(0, 20)}…” is too long. Names can be ${LIMITS.personName} characters at most.`,
      })
    } else if (names.length > LIMITS.membersPerRequest) {
      context.addIssue({
        code: 'custom',
        message: `Add up to ${LIMITS.membersPerRequest} people here. You can add more from Team afterwards.`,
      })
    }
  }),
})

type FormValues = z.infer<typeof formSchema>

function CreatedView({ created, onEnter }: { created: CreateProjectResponse; onEnter: () => void }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    if (await copyToClipboard(created.accessCode)) {
      setCopied(true)
      toast.success('Code copied')
      window.setTimeout(() => setCopied(false), 2000)
    } else {
      toast.error('Couldn’t copy automatically. Select the code and copy it by hand.')
    }
  }

  return (
    <div className="flex flex-col items-center text-center">
      <span className="mb-4 flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
        <Check className="size-6" aria-hidden />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">Project created!</h1>
      <p className="mt-1 max-w-full text-lg text-muted [overflow-wrap:anywhere]">{created.project.name}</p>

      <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-muted">Your Collabo code</p>
      <p
        data-testid="access-code"
        className="mt-2 w-full select-all rounded-2xl border border-line bg-surface px-4 py-5 font-mono text-2xl font-semibold tracking-[0.12em]"
      >
        {created.accessCode}
      </p>
      <p className="mt-3 text-[15px]">Anyone with this code can access and modify this Collabo.</p>
      <p className="mt-2 text-sm text-muted">
        Save it now. We keep only a scrambled version, so it can’t be shown again later. If it’s ever
        lost or shared by mistake, generate a new one from Team.
      </p>

      <div className="mt-8 flex w-full flex-col gap-2 sm:flex-row">
        <Button variant="secondary" size="lg" className="flex-1" onClick={() => void copy()}>
          {copied ? <Check className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
          {copied ? 'Copied' : 'Copy Code'}
        </Button>
        <Button size="lg" className="flex-1" onClick={onEnter}>
          Enter Collabo
        </Button>
      </div>
    </div>
  )
}

/** Name, your name, optionally teammates. That is the whole flow. */
export function CreateCollaboPage() {
  const navigate = useNavigate()
  const create = useCreateProject()
  const report = useReportError()
  const [created, setCreated] = useState<CreateProjectResponse | null>(null)

  const { register, handleSubmit, formState } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: '', creatorName: '', teammates: '' },
  })

  const onSubmit = handleSubmit((values) => {
    create.mutate(
      {
        name: values.name,
        creatorName: values.creatorName,
        memberNames: parseNameList(values.teammates).names,
      },
      { onSuccess: setCreated, onError: report },
    )
  })

  return (
    <main className="mx-auto min-h-dvh w-full max-w-md px-6 py-8">
      {created ? (
        <div className="pt-10">
          <CreatedView created={created} onEnter={() => void navigate('/today')} />
        </div>
      ) : (
        <>
          <Link
            to="/"
            className="-ml-2 mb-6 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-[15px] text-muted hover:bg-raised hover:text-ink"
          >
            <ArrowLeft className="size-4" aria-hidden />
            Back
          </Link>
          <h1 className="text-2xl font-semibold tracking-tight">Create a Collabo</h1>
          <p className="mt-1 text-[15px] text-muted">One shared place for what needs doing. Takes a minute.</p>

          <form onSubmit={onSubmit} noValidate className="mt-8 flex flex-col gap-5">
            <TextField
              label="Collabo name"
              placeholder="e.g. UniVybe Website"
              autoComplete="off"
              autoFocus
              error={formState.errors.name?.message}
              {...register('name')}
            />
            <TextField
              label="Your name"
              placeholder="e.g. Alhaji"
              autoComplete="given-name"
              error={formState.errors.creatorName?.message}
              {...register('creatorName')}
            />

            <TextAreaField
              label="Teammates (optional)"
              hint="One name per line, or separated by commas. Paste a whole list if you like. You can always add people later."
              rows={4}
              autoComplete="off"
              error={formState.errors.teammates?.message}
              {...register('teammates')}
            />

            <Button type="submit" size="lg" loading={create.isPending} className="mt-2">
              Create Collabo
            </Button>
          </form>
        </>
      )}
    </main>
  )
}
