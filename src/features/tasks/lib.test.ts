import { nextOwnStatus } from '@shared/task-progress'
import type { ActorDto, AssigneeDto, MemberDto, TaskDto } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  assigneeLabel,
  compareTasks,
  filterTasks,
  filtersFor,
  groupByDueDate,
  groupTodayTasks,
  isAssigned,
  isOverdue,
  progressAccess,
  progressLabel,
  sortTasks,
  statusActionLabel,
} from './lib'

const actor: ActorDto = { type: 'member', memberId: 'm1', name: 'Mariama' }

let counter = 0
function task(overrides: Partial<TaskDto> = {}): TaskDto {
  counter += 1
  return {
    id: `task-${counter}`,
    title: `Task ${counter}`,
    description: null,
    status: 'todo',
    priority: 'medium',
    assignmentMode: 'all',
    assignees: [],
    assignedToMemberId: null,
    dueDate: null,
    createdByMemberId: 'm1',
    createdBy: actor,
    createdAt: new Date(2026, 9, 1, 9, counter).toISOString(),
    updatedByMemberId: 'm1',
    updatedBy: actor,
    updatedAt: new Date(2026, 9, 1, 9, counter).toISOString(),
    version: 1,
    completedByMemberId: null,
    completedBy: null,
    completedAt: null,
    progressNote: null,
    progressNoteVersion: 0,
    noteUpdatedAt: null,
    noteUpdatedBy: null,
    ...overrides,
  }
}

const done = (overrides: Partial<TaskDto> = {}) =>
  task({
    status: 'completed',
    completedByMemberId: 'm1',
    completedBy: actor,
    completedAt: new Date(2026, 9, 7, 10, 0).toISOString(),
    ...overrides,
  })

function row(memberId: string, status: AssigneeDto['status'] = 'todo'): AssigneeDto {
  return {
    memberId,
    status,
    assignedAt: new Date(2026, 9, 1).toISOString(),
    startedAt: null,
    completedAt: null,
    updatedAt: new Date(2026, 9, 1).toISOString(),
    version: 1,
  }
}

const people: Record<string, MemberDto> = Object.fromEntries(
  ['a', 'b', 'c', 'd', 'e'].map((id, index) => [
    id,
    { id, name: ['Ada', 'Ben', 'Cora', 'Dev', 'Eli'][index]!, isActive: true, createdAt: '' },
  ]),
)
const find = (id: string | null) => (id ? people[id] : undefined)

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
  const mine = task({ assignees: [row('me')], status: 'todo' })
  const shared = task({ assignees: [row('them'), row('me')], status: 'in_progress' })
  const theirs = task({ assignees: [row('them')], status: 'in_progress' })
  const finished = done({ assignees: [row('me', 'completed')] })
  const all = [mine, shared, theirs, finished]

  it('filters by status', () => {
    expect(filterTasks(all, 'all', 'me')).toHaveLength(4)
    expect(filterTasks(all, 'todo', 'me')).toEqual([mine])
    expect(filterTasks(all, 'in_progress', 'me')).toEqual([shared, theirs])
    expect(filterTasks(all, 'completed', 'me')).toEqual([finished])
  })

  it('"mine" includes every task you are one of several assignees on', () => {
    expect(filterTasks(all, 'mine', 'me')).toEqual([mine, shared, finished])
    expect(isAssigned(shared, 'me')).toBe(true)
    expect(isAssigned(theirs, 'me')).toBe(false)
  })

  it('has nothing of its own to show an administrator, and does not offer the filter', () => {
    expect(filterTasks(all, 'mine', null)).toEqual([])
    expect(filtersFor(false).map((filter) => filter.value)).not.toContain('mine')
    expect(filtersFor(true).map((filter) => filter.value)).toContain('mine')
  })
})

describe('who a task is for', () => {
  it('names one, two or many people briefly', () => {
    expect(assigneeLabel(task(), find)).toBe('Unassigned')
    expect(assigneeLabel(task({ assignees: [row('a')] }), find)).toBe('Ada')
    expect(assigneeLabel(task({ assignees: [row('a'), row('b')] }), find)).toBe('Ada and Ben')
    expect(assigneeLabel(task({ assignees: ['a', 'b', 'c', 'd', 'e'].map((id) => row(id)) }), find)).toBe(
      'Ada, Ben +3',
    )
  })

  it('counts finished parts only where everyone has a part', () => {
    const two = [row('a', 'completed'), row('b')]
    expect(progressLabel(task({ assignees: two }))).toBe('1 of 2 done')
    expect(progressLabel(task({ assignees: two, assignmentMode: 'any' }))).toBeNull()
    expect(progressLabel(task({ assignees: [row('a')] }))).toBeNull()
  })
})

describe('your own progress', () => {
  it('lets an assignee move their part, but not someone who is not assigned', () => {
    const shared = task({ assignees: [row('a', 'in_progress'), row('b')] })
    expect(progressAccess(shared, 'a')).toMatchObject({ kind: 'assignee' })
    expect(progressAccess(shared, 'c')).toEqual({ kind: 'not-assigned' })
    expect(progressAccess(shared, null)).toEqual({ kind: 'not-assigned' })
  })

  it('freezes everyone once a task anyone can finish has been finished', () => {
    const finished = done({ assignmentMode: 'any', assignees: [row('a', 'completed'), row('b')] })
    expect(progressAccess(finished, 'b')).toMatchObject({ kind: 'group-completed' })
    // In "everyone" mode a finished task is simply every part done: you can still reopen your own part.
    const allDone = done({ assignees: [row('a', 'completed'), row('b', 'completed')] })
    expect(progressAccess(allDone, 'a')).toMatchObject({ kind: 'assignee' })
  })

  it('steps To Do -> In Progress -> Done, and a finished part reopens to In Progress', () => {
    expect(nextOwnStatus('todo')).toBe('in_progress')
    expect(nextOwnStatus('in_progress')).toBe('completed')
    expect(nextOwnStatus('completed')).toBe('in_progress')
  })

  it('says plainly what finishing does', () => {
    expect(statusActionLabel('todo', 'all')).toBe('Start')
    expect(statusActionLabel('in_progress', 'all')).toBe('Mark my part done')
    expect(statusActionLabel('in_progress', 'any')).toBe('Mark done for everyone')
    expect(statusActionLabel('completed', 'all')).toBe('Reopen my part')
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
