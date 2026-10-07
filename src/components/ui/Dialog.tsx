import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { Button, IconButton } from './Button'

interface BaseProps {
  open: boolean
  onClose: () => void
  className: string
  variant: 'sheet' | 'pop'
  labelledBy: string
  children: ReactNode
}

/**
 * Built on the native <dialog>: the browser provides the focus trap, Escape to
 * close, an inert background and focus restoration, so it is keyboard- and
 * screen-reader-friendly without extra code. Children only mount while open,
 * which resets any form inside when it is reopened.
 */
function ModalDialog({ open, onClose, className, variant, labelledBy, children }: BaseProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const pressStartedOnBackdrop = useRef(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={labelledBy}
      className={cn(variant, className)}
      // Only react to this dialog's own `close`, and only while it is meant to be
      // open. React's synthetic `close` bubbles, so without the target check a
      // nested dialog (the delete confirmation inside the task sheet) would also
      // close its parent; without `open`, a programmatic close() would call onClose twice.
      onClose={(event) => {
        if (open && event.target === event.currentTarget) onClose()
      }}
      onMouseDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the dialog element itself. Requiring the
        // press to have started there avoids closing after a text-selection drag.
        if (pressStartedOnBackdrop.current && event.target === event.currentTarget) onClose()
      }}
    >
      {open && children}
    </dialog>
  )
}

interface SheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

/** Bottom sheet on phones, right-hand drawer on larger screens. */
export function Sheet({ open, onClose, title, children }: SheetProps) {
  const titleId = useId()
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      variant="sheet"
      labelledBy={titleId}
      className={cn(
        'fixed inset-x-0 bottom-0 top-auto m-0 max-h-[92dvh] w-full max-w-none flex-col overflow-hidden',
        'rounded-t-3xl border border-line bg-surface p-0 text-ink shadow-sheet open:flex',
        'backdrop:bg-black/40',
        'sm:inset-y-0 sm:left-auto sm:right-0 sm:h-dvh sm:max-h-none sm:w-[30rem] sm:rounded-none sm:rounded-l-3xl',
      )}
    >
      <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
        <h2 id={titleId} className="min-w-0 py-1.5 text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
          {title}
        </h2>
        <IconButton label="Close" onClick={onClose} className="-mr-2">
          <X className="size-5" aria-hidden />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {children}
      </div>
    </ModalDialog>
  )
}

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  title: string
  description: string
  confirmLabel: string
  onConfirm: () => void
  loading?: boolean
}

/** A small centred confirmation: a question, a sentence of consequence, two buttons. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  confirmLabel,
  onConfirm,
  loading = false,
}: ConfirmDialogProps) {
  const titleId = useId()
  const descriptionId = useId()
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      variant="pop"
      labelledBy={titleId}
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-w-sm rounded-2xl border border-line bg-surface p-5 text-ink shadow-xl',
        'backdrop:bg-black/40',
      )}
    >
      <h2 id={titleId} className="text-lg font-semibold leading-snug [overflow-wrap:anywhere]">
        {title}
      </h2>
      <p id={descriptionId} className="mt-1.5 text-[15px] text-muted">
        {description}
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          {confirmLabel}
        </Button>
      </div>
    </ModalDialog>
  )
}
