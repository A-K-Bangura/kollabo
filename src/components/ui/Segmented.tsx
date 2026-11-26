import { useId, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface SegmentedOption<T extends string> {
  value: T
  label: string
  /** One line under the label; shown for the selected option. */
  description?: string
  icon?: ReactNode
}

interface SegmentedProps<T extends string> {
  legend: string
  value: T
  onChange: (value: T) => void
  options: readonly SegmentedOption<T>[]
  disabled?: boolean
  /** Hide the legend visually (it stays for screen readers). */
  hideLegend?: boolean
  className?: string
}

/** A small set of mutually exclusive choices, as real radio buttons with a segmented look. */
export function Segmented<T extends string>({
  legend,
  value,
  onChange,
  options,
  disabled,
  hideLegend,
  className,
}: SegmentedProps<T>) {
  const name = useId()
  const selected = options.find((option) => option.value === value)

  return (
    <fieldset className={cn('flex flex-col gap-1.5', className)} disabled={disabled}>
      <legend className={cn('mb-1.5 text-sm font-medium', hideLegend && 'sr-only')}>{legend}</legend>
      <div
        className="grid gap-1 rounded-xl bg-raised p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((option) => (
          <label key={option.value} className="relative">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
              className="peer sr-only"
            />
            <span
              className={cn(
                'flex h-11 items-center justify-center gap-1.5 rounded-lg px-1 text-[13px] font-medium text-muted transition sm:text-sm',
                'peer-checked:bg-surface peer-checked:text-ink peer-checked:shadow-sm',
                'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
                'peer-disabled:opacity-60',
              )}
            >
              {option.icon}
              <span className="truncate">{option.label}</span>
            </span>
          </label>
        ))}
      </div>
      {selected?.description && <p className="text-sm text-muted">{selected.description}</p>}
    </fieldset>
  )
}
