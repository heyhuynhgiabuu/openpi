import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '../electron/session/sessionEntries'
import {
  buildTreeNodes,
  collectLeaves,
  countBranches,
  entryToTreeNode,
  traceToRoot,
} from '../electron/session/sessionTree'

/** Fields the fixtures vary; the rest of an entry is fixed by `entry()`. */
interface EntryFields {
  type?: string
  message?: { role: string; content: unknown }
  reason?: string
  result?: { tokensBefore?: number; summary?: string }
  targetId?: string
  label?: string
  modelId?: string
  name?: string
  thinkingLevel?: string
  summary?: string
}

function entry(id: string, parentId: string | null, fields: EntryFields = {}): SessionEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-09-14T10:00:00.000Z',
    ...fields,
  }
}

function childrenOf(entries: SessionEntry[]): Map<string | null, SessionEntry[]> {
  const map = new Map<string | null, SessionEntry[]>()
  for (const item of entries) {
    const kids = map.get(item.parentId) ?? []
    kids.push(item)
    map.set(item.parentId, kids)
  }
  return map
}

function byId(entries: SessionEntry[]): Map<string, SessionEntry> {
  return new Map(entries.map((item) => [item.id, item]))
}

/** root → a → b, with c forked off a. */
const forked = [entry('root', null), entry('a', 'root'), entry('b', 'a'), entry('c', 'a')]

describe('countBranches', () => {
  it('counts nothing for a straight chain', () => {
    expect(countBranches([entry('root', null), entry('a', 'root'), entry('b', 'a')])).toBe(0)
  })

  it('counts one branch per extra child', () => {
    expect(countBranches(forked)).toBe(1)
    expect(countBranches([...forked, entry('d', 'a')])).toBe(2)
  })

  it('counts a second root as a branch', () => {
    // The parser drops the `session` header (normalizeSessionEntry returns null for
    // it), so a second null-parent entry here means a genuinely separate root.
    expect(countBranches([entry('root', null), entry('other', null), entry('a', 'root')])).toBe(1)
  })
})

describe('collectLeaves', () => {
  it('finds the single leaf of a chain', () => {
    expect(collectLeaves('root', childrenOf([entry('root', null), entry('a', 'root')]))).toEqual([
      'a',
    ])
  })

  it('finds every leaf of a fork', () => {
    const leaves = collectLeaves('root', childrenOf(forked))
    expect([...leaves].sort()).toEqual(['b', 'c'])
  })

  it('returns nothing without a start id', () => {
    expect(collectLeaves(null, childrenOf(forked))).toEqual([])
  })

  it('terminates on a cycle instead of looping forever', () => {
    const cyclic = [entry('x', 'y'), entry('y', 'x')]
    expect(collectLeaves('x', childrenOf(cyclic))).toEqual([])
  })
})

describe('traceToRoot', () => {
  it('returns the path ordered root to leaf', () => {
    expect(traceToRoot('b', byId(forked))).toEqual(['root', 'a', 'b'])
  })

  it('returns just the leaf when the chain is broken', () => {
    expect(traceToRoot('orphan', byId(forked))).toEqual(['orphan'])
    expect(traceToRoot('a', byId([entry('a', 'missing')]))).toEqual(['a'])
  })
})

describe('buildTreeNodes', () => {
  it('enriches the entries it knows', () => {
    const nodes = buildTreeNodes(['root', 'b'], byId(forked))
    expect(nodes.map((node) => node.id)).toEqual(['root', 'b'])
    expect(nodes[1]?.parentId).toBe('a')
  })

  it('keeps a placeholder for an entry that is not in the map', () => {
    expect(buildTreeNodes(['gone'], byId(forked))).toEqual([
      { id: 'gone', parentId: null, type: 'message', timestamp: '' },
    ])
  })
})

describe('entryToTreeNode', () => {
  it('previews a message with its role', () => {
    const node = entryToTreeNode(
      entry('m', null, {
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello there' }] },
      })
    )
    expect(node.type).toBe('message')
    expect(node.role).toBe('assistant')
    expect(node.contentPreview).toBe('hello there')
  })

  it('previews at most 80 characters', () => {
    const node = entryToTreeNode(
      entry('m', null, { message: { role: 'user', content: 'x'.repeat(200) } })
    )
    expect(node.contentPreview).toHaveLength(80)
  })

  it('describes a compaction', () => {
    const node = entryToTreeNode(
      entry('k', null, {
        type: 'compaction',
        reason: 'context limit',
        result: { tokensBefore: 1200, summary: 'compacted' },
      })
    )
    expect(node.type).toBe('compaction')
    expect(node.tokensBefore).toBe(1200)
    expect(node.compactionReason).toBe('context limit')
    expect(node.summary).toBe('compacted')
  })

  it('describes a label on another entry', () => {
    const node = entryToTreeNode(
      entry('l', null, { type: 'label', targetId: 'a', label: 'checkpoint' })
    )
    expect(node.targetId).toBe('a')
    expect(node.summary).toBe('checkpoint')
  })

  it('describes branch summaries, model changes, and session info', () => {
    expect(
      entryToTreeNode(entry('s', null, { type: 'branch_summary', summary: 'other' })).summary
    ).toBe('other')
    expect(
      entryToTreeNode(entry('m', null, { type: 'model_change', modelId: 'gpt-5' })).modelId
    ).toBe('gpt-5')
    expect(entryToTreeNode(entry('i', null, { type: 'session_info', name: 'Refactor' })).name).toBe(
      'Refactor'
    )
  })

  it('describes a thinking level change either way', () => {
    expect(
      entryToTreeNode(entry('t', null, { type: 'thinking_level_change', thinkingLevel: 'high' }))
        .summary
    ).toBe('Thinking level: high')
    expect(entryToTreeNode(entry('t', null, { type: 'thinking_level_change' })).summary).toBe(
      'Thinking level changed'
    )
  })

  it('shows extension entries as messages', () => {
    expect(entryToTreeNode(entry('c', null, { type: 'custom' })).type).toBe('message')
    expect(entryToTreeNode(entry('c', null, { type: 'custom_message' })).type).toBe('message')
  })

  it('leaves unknown entry types bare', () => {
    const node = entryToTreeNode(entry('u', null, { type: 'bashExecution' }))
    expect(node.summary).toBeUndefined()
    expect(node.contentPreview).toBeUndefined()
  })
})
