import {
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  isSameDay,
  parse,
  parseISO,
} from 'date-fns'

/**
 * Due dates are calendar dates ("2026-10-10"), not instants. They are only ever
 * parsed into *local* dates here, so no timezone can shift one by a day.
 */
const DATE_KEY = 'yyyy-MM-dd'

export function toDateKey(date: Date): string {
  return format(date, DATE_KEY)
}

export function parseDateKey(key: string): Date {
  return parse(key, DATE_KEY, new Date())
}

export function todayKey(now: Date = new Date()): string {
  return toDateKey(now)
}

/** "Today", "Tomorrow", "Yesterday", "Mon, Oct 12", or "Oct 12, 2027" for other years. */
export function formatDueDate(key: string, today: string = todayKey()): string {
  const date = parseDateKey(key)
  const reference = parseDateKey(today)
  const difference = differenceInCalendarDays(date, reference)

  if (difference === 0) return 'Today'
  if (difference === 1) return 'Tomorrow'
  if (difference === -1) return 'Yesterday'
  return format(date, date.getFullYear() === reference.getFullYear() ? 'EEE, MMM d' : 'MMM d, yyyy')
}

/** "Wednesday, October 7" */
export function formatLongDate(key: string): string {
  return format(parseDateKey(key), 'EEEE, MMMM d')
}

/** Activity time: just the clock for today, with the date for earlier days. */
export function formatActivityTime(iso: string, now: Date = new Date()): string {
  const date = parseISO(iso)
  return format(date, isSameDay(date, now) ? 'h:mm a' : 'MMM d, h:mm a')
}

/** "Last refreshed ..." wording: relative while recent, then the clock time. */
export function formatRefreshed(timestamp: number, now: number = Date.now()): string {
  const minutes = differenceInMinutes(now, timestamp)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return minutes === 1 ? '1 minute ago' : `${minutes} minutes ago`
  const date = new Date(timestamp)
  return format(date, isSameDay(date, now) ? 'h:mm a' : 'MMM d, h:mm a')
}
