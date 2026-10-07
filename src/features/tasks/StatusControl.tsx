import { STATUS_LABELS, TASK_STATUSES, type TaskStatus } from '@shared/constants'
import { cn } from '@/lib/cn'
import { StatusIcon } from './StatusIcon'

interface StatusControlProps {
  value: TaskStatus
  onChange: (status: TaskStatus) => void
  disabled?: boolean
}

/** Direct access to any of the three statuses (the list rows only step forward). */
export function StatusControl({ value, onChange, disabled }: StatusControlProps) {
  return (
    <div role="group" aria-label="Status" className="grid grid-cols-3 gap-1 rounded-xl bg-raised p-1">
      {TASK_STATUSES.map((status) => {
        const selected = status === value
        return (
          <button
            key={status}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => !selected && onChange(status)}
            className={cn(
              'flex h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-medium transition sm:text-sm',
              'disabled:opacity-60',
              selected ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink',
            )}
          >
            <StatusIcon status={status} className="size-5" />
            <span className="truncate">{STATUS_LABELS[status]}</span>
          </button>
        )
      })}
    </div>
  )
}
