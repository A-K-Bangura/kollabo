import { describe, expect, it } from 'vitest'
import type { TaskStatus } from './constants.js'
import {
  aggregateStatus,
  describeModeChange,
  hasProgress,
  latestCompleter,
  nextOwnStatus,
  ownProgressBlock,
  progressCounts,
  statusAfterModeChange,
} from './task-progress.js'

const rows = (...statuses: TaskStatus[]) => statuses.map((status) => ({ status }))

describe('ALL mode: derived entirely from the assignees', () => {
  it('is completed only when every assignee is completed', () => {
    expect(aggregateStatus('all', 'todo', rows('completed', 'completed', 'completed'))).toBe('completed')
    expect(aggregateStatus('all', 'in_progress', rows('completed', 'completed', 'in_progress'))).toBe('in_progress')
    expect(aggregateStatus('all', 'in_progress', rows('completed', 'todo', 'todo'))).toBe('in_progress')
  })

  it('is in progress as soon as anyone has started, to do otherwise', () => {
    expect(aggregateStatus('all', 'todo', rows('in_progress', 'todo'))).toBe('in_progress')
    expect(aggregateStatus('all', 'todo', rows('todo', 'todo'))).toBe('todo')
  })

  it('does not depend on the previous status: reopening one part reopens the task', () => {
    expect(aggregateStatus('all', 'completed', rows('completed', 'in_progress'))).toBe('in_progress')
    expect(aggregateStatus('all', 'completed', rows('completed', 'todo'))).toBe('in_progress')
  })

  it('treats a single assignee the same in either mode while the task is open', () => {
    for (const status of ['todo', 'in_progress', 'completed'] as TaskStatus[]) {
      expect(aggregateStatus('all', 'todo', rows(status))).toBe(
        aggregateStatus('any', status === 'completed' ? 'completed' : 'todo', rows(status)),
      )
    }
  })

  it('an incomplete assignee added to a completed task reopens it', () => {
    const before = rows('completed', 'completed')
    expect(aggregateStatus('all', 'todo', before)).toBe('completed')
    expect(aggregateStatus('all', 'completed', [...before, ...rows('todo')])).toBe('in_progress')
  })

  it('removing the only incomplete assignee completes the task', () => {
    expect(aggregateStatus('all', 'in_progress', rows('completed', 'completed'))).toBe('completed')
  })
})

describe('ANY mode: completion is sticky until explicitly reopened', () => {
  it('derives to do / in progress while open', () => {
    expect(aggregateStatus('any', 'todo', rows('todo', 'todo'))).toBe('todo')
    expect(aggregateStatus('any', 'todo', rows('in_progress', 'todo'))).toBe('in_progress')
  })

  it('stays completed whatever the assignees look like (no implicit reopening)', () => {
    expect(aggregateStatus('any', 'completed', rows('todo', 'todo'))).toBe('completed')
    expect(aggregateStatus('any', 'completed', rows('in_progress', 'todo', 'todo'))).toBe('completed')
    // e.g. the person who completed it was removed, or a new assignee was added
    expect(aggregateStatus('any', 'completed', rows('todo'))).toBe('completed')
  })

  it('does not become completed merely because someone completed in a derived calculation', () => {
    // Completion is an explicit action recorded on the task, never inferred while open.
    expect(aggregateStatus('any', 'in_progress', rows('in_progress', 'todo'))).toBe('in_progress')
  })
})

describe('tasks with no assignees (legacy)', () => {
  it('keep their stored status', () => {
    for (const status of ['todo', 'in_progress', 'completed'] as TaskStatus[]) {
      expect(aggregateStatus('all', status, [])).toBe(status)
      expect(aggregateStatus('any', status, [])).toBe(status)
      expect(statusAfterModeChange('all', 'any', status, [])).toBe(status)
    }
  })
})

describe('switching modes is deterministic', () => {
  it('ANY -> ALL: only explicitly completed assignees count as individually complete', () => {
    // One person finished the task for the group; two others never did their part.
    expect(statusAfterModeChange('any', 'all', 'completed', rows('completed', 'todo', 'todo'))).toBe('in_progress')
    expect(statusAfterModeChange('any', 'all', 'completed', rows('completed', 'in_progress', 'todo'))).toBe('in_progress')
  })

  it('ANY -> ALL: stays completed when everyone really is complete', () => {
    expect(statusAfterModeChange('any', 'all', 'completed', rows('completed', 'completed'))).toBe('completed')
    expect(statusAfterModeChange('any', 'all', 'completed', rows('completed'))).toBe('completed')
  })

  it('ANY -> ALL: an open task is recalculated by the ALL rule', () => {
    expect(statusAfterModeChange('any', 'all', 'in_progress', rows('in_progress', 'todo'))).toBe('in_progress')
    expect(statusAfterModeChange('any', 'all', 'todo', rows('todo', 'todo'))).toBe('todo')
  })

  it('ALL -> ANY: a completed task stays completed', () => {
    expect(statusAfterModeChange('all', 'any', 'completed', rows('completed', 'completed'))).toBe('completed')
  })

  it('ALL -> ANY: existing completed work is retained, so partial completion completes the task', () => {
    expect(statusAfterModeChange('all', 'any', 'in_progress', rows('completed', 'todo', 'todo'))).toBe('completed')
  })

  it('ALL -> ANY: without any completed work the task is simply derived', () => {
    expect(statusAfterModeChange('all', 'any', 'in_progress', rows('in_progress', 'todo'))).toBe('in_progress')
    expect(statusAfterModeChange('all', 'any', 'todo', rows('todo', 'todo'))).toBe('todo')
  })

  it('is a no-op when the mode does not change', () => {
    expect(statusAfterModeChange('all', 'all', 'in_progress', rows('completed', 'todo'))).toBe('in_progress')
    expect(statusAfterModeChange('any', 'any', 'completed', rows('todo'))).toBe('completed')
  })

  it('picks the most recent completer, independent of row order', () => {
    const a = { memberId: 'a', status: 'completed' as const, completedAt: '2026-10-01T10:00:00Z' }
    const b = { memberId: 'b', status: 'completed' as const, completedAt: '2026-10-02T10:00:00Z' }
    const c = { memberId: 'c', status: 'todo' as const, completedAt: null }
    expect(latestCompleter([a, b, c])?.memberId).toBe('b')
    expect(latestCompleter([c, b, a])?.memberId).toBe('b')
    expect(latestCompleter([c])).toBeNull()
    const tieA = { ...a, completedAt: b.completedAt }
    expect(latestCompleter([b, tieA])?.memberId).toBe('a')
  })
})

describe('mode-change confirmation', () => {
  it('needs confirmation only when progress exists and the mode really changes', () => {
    expect(describeModeChange('all', 'any', 'todo', rows('todo', 'todo')).needsConfirmation).toBe(false)
    expect(describeModeChange('all', 'any', 'in_progress', rows('in_progress', 'todo')).needsConfirmation).toBe(true)
    expect(describeModeChange('all', 'all', 'in_progress', rows('in_progress')).needsConfirmation).toBe(false)
  })

  it('says what will happen to the status', () => {
    expect(describeModeChange('any', 'all', 'completed', rows('completed', 'todo'))).toMatchObject({
      before: 'completed',
      after: 'in_progress',
      changesStatus: true,
    })
    expect(describeModeChange('all', 'any', 'in_progress', rows('completed', 'todo'))).toMatchObject({
      after: 'completed',
      changesStatus: true,
    })
  })

  it('detects progress from the task status or any assignee', () => {
    expect(hasProgress('todo', rows('todo'))).toBe(false)
    expect(hasProgress('in_progress', rows('todo'))).toBe(true)
    expect(hasProgress('todo', rows('in_progress'))).toBe(true)
  })
})

describe('individual progress', () => {
  it('blocks progress changes on a group-completed ANY task, but not on ALL', () => {
    expect(ownProgressBlock('any', 'completed')).toBe('GROUP_COMPLETED')
    expect(ownProgressBlock('any', 'in_progress')).toBeNull()
    expect(ownProgressBlock('all', 'completed')).toBeNull()
  })

  it('steps To Do -> In Progress -> Done, and reopens a finished part to In Progress', () => {
    expect(nextOwnStatus('todo')).toBe('in_progress')
    expect(nextOwnStatus('in_progress')).toBe('completed')
    expect(nextOwnStatus('completed')).toBe('in_progress')
  })

  it('counts completed / assigned', () => {
    expect(progressCounts(rows('completed', 'todo', 'completed'))).toEqual({ completed: 2, total: 3 })
  })
})
