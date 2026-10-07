import { useCallback } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router'

const SHEET_PARAMS = ['task', 'new', 'due'] as const
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * The task sheet (new task / task details) lives in the URL: `?task=<id>` or
 * `?new=1`. That makes the browser Back button close it, and lets any screen
 * open it. Nothing sensitive is ever put in the URL: only a task id.
 */
export function useTaskSheet() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()

  const taskId = params.get('task')
  const isNew = params.has('new')
  const due = params.get('due')
  const defaultDueDate = due !== null && DATE_PATTERN.test(due) ? due : null

  const open = useCallback(
    (values: Record<string, string>) => {
      setParams(
        (previous) => {
          const next = new URLSearchParams(previous)
          for (const key of SHEET_PARAMS) next.delete(key)
          for (const [key, value] of Object.entries(values)) next.set(key, value)
          return next
        },
        { state: { sheet: true } },
      )
    },
    [setParams],
  )

  const openTask = useCallback((id: string) => open({ task: id }), [open])
  const openNew = useCallback(
    (dueDate?: string) => open(dueDate ? { new: '1', due: dueDate } : { new: '1' }),
    [open],
  )

  const close = useCallback(() => {
    // Opened from inside the app: step back so history stays tidy. Opened from a
    // pasted link: there is nothing to go back to, so just drop the parameters.
    if ((location.state as { sheet?: boolean } | null)?.sheet) {
      void navigate(-1)
      return
    }
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const key of SHEET_PARAMS) next.delete(key)
        return next
      },
      { replace: true },
    )
  }, [location.state, navigate, setParams])

  return { taskId, isNew, defaultDueDate, openTask, openNew, close }
}
