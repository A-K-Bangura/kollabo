import { addDays } from 'date-fns'
import { describe, expect, it } from 'vitest'
import {
  formatActivityTime,
  formatDueDate,
  formatRefreshed,
  parseDateKey,
  toDateKey,
  todayKey,
} from './dates'

describe('calendar dates', () => {
  it('round-trips every day of a year, including daylight-saving changes', () => {
    let day = new Date(2026, 0, 1)
    for (let index = 0; index < 366; index += 1) {
      const key = toDateKey(day)
      const parsed = parseDateKey(key)
      expect(toDateKey(parsed)).toBe(key)
      expect(parsed.getHours()).toBe(0)
      day = addDays(day, 1)
    }
  })

  it('keeps October 10 as October 10', () => {
    const date = parseDateKey('2026-10-10')
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 9, 10])
  })

  it('derives today from the local date, not UTC', () => {
    const lateEvening = new Date(2026, 9, 10, 23, 30)
    expect(todayKey(lateEvening)).toBe('2026-10-10')
    const justAfterMidnight = new Date(2026, 9, 11, 0, 5)
    expect(todayKey(justAfterMidnight)).toBe('2026-10-11')
  })
})

describe('formatDueDate', () => {
  const today = '2026-10-07'

  it('names the days around today', () => {
    expect(formatDueDate('2026-10-07', today)).toBe('Today')
    expect(formatDueDate('2026-10-08', today)).toBe('Tomorrow')
    expect(formatDueDate('2026-10-06', today)).toBe('Yesterday')
  })

  it('shows weekday and date within the year, and the year otherwise', () => {
    expect(formatDueDate('2026-10-12', today)).toBe('Mon, Oct 12')
    expect(formatDueDate('2027-01-05', today)).toBe('Jan 5, 2027')
  })
})

describe('time labels', () => {
  const now = new Date(2026, 9, 7, 15, 0)

  it('shows only the clock for activity today and the date for earlier days', () => {
    expect(formatActivityTime(new Date(2026, 9, 7, 9, 42).toISOString(), now)).toBe('9:42 AM')
    expect(formatActivityTime(new Date(2026, 9, 5, 14, 14).toISOString(), now)).toBe('Oct 5, 2:14 PM')
  })

  it('describes refreshes relatively, then by clock time', () => {
    const at = (minutesAgo: number) => now.getTime() - minutesAgo * 60_000
    expect(formatRefreshed(at(0), now.getTime())).toBe('just now')
    expect(formatRefreshed(at(1), now.getTime())).toBe('1 minute ago')
    expect(formatRefreshed(at(2), now.getTime())).toBe('2 minutes ago')
    expect(formatRefreshed(new Date(2026, 9, 7, 8, 42).getTime(), now.getTime())).toBe('8:42 AM')
  })
})
