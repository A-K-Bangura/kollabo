import type { TaskDto } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  compareTasks,
  filterTasks,
  groupByDueDate,
  groupTodayTasks,
  isOverdue,
  nextStatus,
  sortTasks,
} from './lib'

let counter = 0
function task(overrides: Partial<TaskDto> = {}): TaskDto {
  counter += 1
  return {
    id: `task-${counter}`,
    title: `Task ${counter}`,
    description: null,
    status: 'todo',
    priority: 'medium',
    assignedToMemberId: null,
    dueDate: null,
    createdByMemberId: 'm1',
    createdAt: new Date(2026, 9, 1, 9, counter).toISOString(),
    updatedByMemberId: 'm1',
    updatedAt: new Date(2026, 9, 1, 9, counter).toISOString(),
    version: 1,
    completedByMemberId: null,
    completedAt: null,
    ...overrides,
  }
}

const done = (overrides: Partial<TaskDto> = {}) =>
  task({
    status: 'completed',
    completedByMemberId: 'm1',
    completedAt: new Date(2026, 9, 7, 10, 0).toISOString(),
    ...overrides,
  })

describe('groupTodayTasks (the Today screen)', () => {
  const today = '2026-10-07'

  it('splits open work into overdue and due today, and ignores the future and undated', () => {
    const overdue = task({ dueDate: '2026-10-05' })
    const dueToday = task({ dueDate: '2026-10-07' })
    const tomorrow = task({ dueDate: '2026-10-08' })
    const undated = task()

    const groups = groupTodayTasks([overdue, dueToday, tomorrow, undated], today)
    expect(groups.overdue).toEqual([overdue])
    expect(groups.dueToday).toEqual([dueToday])
    expect(groups.completedToday).toEqual([])
  })

  it('never reports finished work as overdue or due, but lists what was completed today', () => {
    const lateButDone = done({ dueDate: '2026-10-01' })
    const dueTodayDone = done({ dueDate: '2026-10-07' })
    const doneYesterday = done({
      dueDate: '2026-10-06',
      completedAt: new Date(2026, 9, 6, 23, 59).toISOString(),
    })

    const groups = groupTodayTasks([lateButDone, dueTodayDone, doneYesterday], today)
    expect(groups.overdue).toEqual([])
    expect(groups.dueToday).toEqual([])
    expect(groups.completedToday).toHaveLength(2)
    expect(groups.completedToday).not.toContainEqual(doneYesterday)
  })

  it('counts in-progress work, and puts high priority first within a day', () => {
    const low = task({ dueDate: today, priority: 'low' })
    const high = task({ dueDate: today, priority: 'high', status: 'in_progress' })
    const groups = groupTodayTasks([low, high], today)
    expect(groups.dueToday).toEqual([high, low])
  })

  it('treats the due date as a calendar day: due today is not yet overdue', () => {
    expect(isOverdue(task({ dueDate: '2026-10-07' }), today)).toBe(false)
    expect(isOverdue(task({ dueDate: '2026-10-06' }), today)).toBe(true)
    expect(isOverdue(done({ dueDate: '2026-10-06' }), today)).toBe(false)
  })
})

describe('filterTasks', () => {
  const mine = task({ assignedToMemberId: 'me', status: 'todo' })
  const theirs = task({ assignedToMemberId: 'them', status: 'in_progress' })
  const finished = done({ assignedToMemberId: 'me' })
  const all = [mine, theirs, finished]

  it('filters by assignee and by each status', () => {
    expect(filterTasks(all, 'all', 'me')).toHaveLength(3)
    expect(filterTasks(all, 'mine', 'me')).toEqual([mine, finished])
    expect(filterTasks(all, 'todo', 'me')).toEqual([mine])
    expect(filterTasks(all, 'in_progress', 'me')).toEqual([theirs])
    expect(filterTasks(all, 'completed', 'me')).toEqual([finished])
  })
})

describe('sorting', () => {
  it('puts open work before finished, by due date, with undated last', () => {
    const later = task({ dueDate: '2026-10-20' })
    const sooner = task({ dueDate: '2026-10-09' })
    const undated = task()
    const finished = done({ dueDate: '2026-10-01' })
    expect(sortTasks([finished, undated, later, sooner])).toEqual([sooner, later, undated, finished])
  })

  it('orders finished work by most recent completion', () => {
    const earlier = done({ completedAt: new Date(2026, 9, 6).toISOString() })
    const recent = done({ completedAt: new Date(2026, 9, 7).toISOString() })
    expect(sortTasks([earlier, recent])).toEqual([recent, earlier])
  })

  it('is a stable, antisymmetric ordering', () => {
    const a = task({ dueDate: '2026-10-09', priority: 'high' })
    const b = task({ dueDate: '2026-10-09', priority: 'high' })
    expect(Math.sign(compareTasks(a, b))).toBe(-Math.sign(compareTasks(b, a)))
  })
})

describe('calendar grouping', () => {
  it('groups tasks under their due date and skips undated ones', () => {
    const a = task({ dueDate: '2026-10-10' })
    const b = task({ dueDate: '2026-10-10' })
    const c = task({ dueDate: '2026-10-11' })
    const groups = groupByDueDate([a, b, c, task()])
    expect([...groups.keys()].sort()).toEqual(['2026-10-10', '2026-10-11'])
    expect(groups.get('2026-10-10')).toHaveLength(2)
  })
})

describe('nextStatus', () => {
  it('moves To Do -> In Progress -> Done, and reopens a finished task', () => {
    expect(nextStatus('todo')).toBe('in_progress')
    expect(nextStatus('in_progress')).toBe('completed')
    expect(nextStatus('completed')).toBe('todo')
  })
})
