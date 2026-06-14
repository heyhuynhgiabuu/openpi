import { describe, expect, it } from 'vitest'
import type { SubagentArtifact } from '../src/lib/ipc/_full'
import { SubagentFileTracker } from '../src/lib/subagentFileTracker'

function makeArtifact(overrides: Partial<SubagentArtifact> = {}): SubagentArtifact {
  return {
    id: 'task-1',
    agent: 'worker',
    prompt: 'do work',
    context: '# CONTEXT\ndo work',
    result: null,
    status: 'running',
    createdAt: 1000,
    completedAt: null,
    filePath: '/tmp/.pi/artifacts/task-1',
    ...overrides,
  }
}

describe('SubagentFileTracker', () => {
  it('starts empty', () => {
    const t = new SubagentFileTracker()
    expect(t.snapshot()).toEqual([])
  })

  it('apply() adds artifacts', () => {
    const t = new SubagentFileTracker()
    const changed = t.apply([makeArtifact({ id: 'task-1' }), makeArtifact({ id: 'task-2' })])
    expect(changed).toBe(true)
    expect(t.snapshot()).toHaveLength(2)
  })

  it('snapshot() sorts by createdAt descending', () => {
    const t = new SubagentFileTracker()
    t.apply([
      makeArtifact({ id: 'task-1', createdAt: 100 }),
      makeArtifact({ id: 'task-2', createdAt: 300 }),
      makeArtifact({ id: 'task-3', createdAt: 200 }),
    ])
    const ids = t.snapshot().map((a) => a.id)
    expect(ids).toEqual(['task-2', 'task-3', 'task-1'])
  })

  it('apply() returns false when state is unchanged', () => {
    const t = new SubagentFileTracker()
    t.apply([makeArtifact({ id: 'task-1' })])
    const changed = t.apply([makeArtifact({ id: 'task-1' })])
    expect(changed).toBe(false)
  })

  it('apply() returns true when status changes', () => {
    const t = new SubagentFileTracker()
    t.apply([makeArtifact({ id: 'task-1', status: 'running', result: null })])
    const changed = t.apply([makeArtifact({ id: 'task-1', status: 'completed', result: 'done' })])
    expect(changed).toBe(true)
  })

  it('apply() returns true when an artifact is removed', () => {
    const t = new SubagentFileTracker()
    t.apply([makeArtifact({ id: 'task-1' }), makeArtifact({ id: 'task-2' })])
    const changed = t.apply([makeArtifact({ id: 'task-1' })])
    expect(changed).toBe(true)
    expect(t.snapshot()).toHaveLength(1)
  })

  it('apply() returns true when completedAt changes', () => {
    const t = new SubagentFileTracker()
    t.apply([makeArtifact({ id: 'task-1', status: 'running', completedAt: null })])
    const changed = t.apply([
      makeArtifact({ id: 'task-1', status: 'completed', completedAt: 2000 }),
    ])
    expect(changed).toBe(true)
  })

  it('apply() returns false when only field order changes (not used in real life but safe)', () => {
    const t = new SubagentFileTracker()
    t.apply([
      makeArtifact({ id: 'task-1', agent: 'a' }),
      makeArtifact({ id: 'task-2', agent: 'b' }),
    ])
    const changed = t.apply([
      makeArtifact({ id: 'task-2', agent: 'b' }),
      makeArtifact({ id: 'task-1', agent: 'a' }),
    ])
    expect(changed).toBe(false)
  })

  it('get() returns a specific artifact by id', () => {
    const t = new SubagentFileTracker()
    t.apply([makeArtifact({ id: 'task-7', agent: 'reviewer' })])
    expect(t.get('task-7')?.agent).toBe('reviewer')
    expect(t.get('task-99')).toBeUndefined()
  })

  it('clear() empties state', () => {
    const t = new SubagentFileTracker()
    t.apply([makeArtifact({ id: 'task-1' })])
    t.clear()
    expect(t.snapshot()).toEqual([])
  })
})
