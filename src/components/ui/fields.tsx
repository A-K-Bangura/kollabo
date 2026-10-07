import { ChevronDown } from 'lucide-react'
import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from '@/lib/cn'

const CONTROL =
  'w-full rounded-xl border border-line bg-surface px-3.5 text-base text-ink transition ' +
  'hover:border-muted/50 aria-[invalid=true]:border-danger disabled:opacity-60'

interface FieldProps {
  label: string
  error?: string | undefined
  hint?: string
}

interface ShellProps extends FieldProps {
  id: string
  children: ReactNode
  className?: string | undefined
}

/** Label + control + hint/error, wired together for assistive technology. */
function FieldShell({ id, label, error, hint, className, children }: ShellProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-sm text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  )
}

function describedBy(id: string, { error, hint }: FieldProps): string | undefined {
  if (error) return `${id}-error`
  if (hint) return `${id}-hint`
  return undefined
}

export function TextField({
  label,
  error,
  hint,
  className,
  id: idProp,
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  const generated = useId()
  const id = idProp ?? generated
  return (
    <FieldShell id={id} label={label} error={error} className={className} {...(hint ? { hint } : {})}>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, error, ...(hint ? { hint } : {}) })}
        className={cn(CONTROL, 'h-11')}
        {...props}
      />
    </FieldShell>
  )
}

export function TextAreaField({
  label,
  error,
  hint,
  className,
  id: idProp,
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const generated = useId()
  const id = idProp ?? generated
  return (
    <FieldShell id={id} label={label} error={error} className={className} {...(hint ? { hint } : {})}>
      <textarea
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, { label, error, ...(hint ? { hint } : {}) })}
        className={cn(CONTROL, 'min-h-24 resize-y py-2.5')}
        {...props}
      />
    </FieldShell>
  )
}

export function SelectField({
  label,
  error,
  hint,
  className,
  id: idProp,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const generated = useId()
  const id = idProp ?? generated
  return (
    <FieldShell id={id} label={label} error={error} className={className} {...(hint ? { hint } : {})}>
      <div className="relative">
        <select
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, { label, error, ...(hint ? { hint } : {}) })}
          className={cn(CONTROL, 'h-11 appearance-none pr-10')}
          {...props}
        >
          {children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
    </FieldShell>
  )
}
