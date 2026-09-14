import { describe, expect, it } from 'vitest'
import {
  DEFAULT_HISTORY_PAGE_LIMIT,
  MAX_HISTORY_PAGE_LIMIT,
  historyPageCacheKey,
  normalizeHistoryLimit,
  normalizeSessionEntry,
} from '../electron/session/sessionEntries'

describe('normalizeSessionEntry', () => {
  it('drops the session header line', () => {
    // Every session file starts with `{ type: "session", ... }`, which carries no
    // id or parentId; treating it as an entry would invent a second root.
    expect(normalizeSessionEntry({ type: 'session', id: 'uuid', cwd: '/tmp' })).toBeNull()
  })

  it('drops entries without a usable id', () => {
    expect(normalizeSessionEntry({ type: 'message' })).toBeNull()
    expect(normalizeSessionEntry({ type: 'message', id: '' })).toBeNull()
    expect(normalizeSessionEntry({ type: 'message', id: 42 })).toBeNull()
  })

  it('normalizes a missing parent to a root and a missing timestamp to empty', () => {
    expect(normalizeSessionEntry({ type: 'message', id: 'a' })).toEqual({
      type: 'message',
      id: 'a',
      parentId: null,
      timestamp: '',
    })
  })

  it('keeps a parent id and the rest of the entry', () => {
    const normalized = normalizeSessionEntry({
      type: 'message',
      id: 'b',
      parentId: 'a',
      timestamp: '2026-09-14T10:00:00.000Z',
      message: { role: 'user', content: 'hi' },
    })
    expect(normalized?.parentId).toBe('a')
    expect(normalized?.timestamp).toBe('2026-09-14T10:00:00.000Z')
    expect(normalized?.message).toEqual({ role: 'user', content: 'hi' })
  })
})

describe('normalizeSessionEntry field passthrough', () => {
  it('keeps the fields each entry type needs downstream', () => {
    // The session map reads these off the normalized entry, so a whitelist that
    // drops unknown fields would silently blank those rows.
    const compaction = normalizeSessionEntry({
      type: 'compaction',
      id: 'k',
      parentId: 'a',
      timestamp: '2026-09-14T10:00:00.000Z',
      reason: 'context limit',
      result: { tokensBefore: 1200, summary: 'compacted' },
    })
    expect(compaction?.reason).toBe('context limit')
    expect(compaction?.result).toEqual({ tokensBefore: 1200, summary: 'compacted' })

    const modelChange = normalizeSessionEntry({
      type: 'model_change',
      id: 'm',
      parentId: 'a',
      timestamp: '2026-09-14T10:00:00.000Z',
      provider: 'anthropic',
      modelId: 'claude-sonnet-5',
    })
    expect(modelChange?.modelId).toBe('claude-sonnet-5')
    expect(modelChange?.provider).toBe('anthropic')
  })
})

describe('normalizeHistoryLimit', () => {
  it('falls back to the documented page size', () => {
    // Literals on purpose: the page size is a product decision, so changing it
    // should require changing a test, not just a constant.
    expect(DEFAULT_HISTORY_PAGE_LIMIT).toBe(200)
    expect(normalizeHistoryLimit(undefined)).toBe(200)
    expect(normalizeHistoryLimit(Number.NaN)).toBe(200)
    expect(normalizeHistoryLimit(0)).toBe(200)
  })

  it('clamps a negative request to a single entry', () => {
    expect(normalizeHistoryLimit(-5)).toBe(1)
  })

  it('keeps a usable page size and floors a fraction', () => {
    expect(normalizeHistoryLimit(10)).toBe(10)
    expect(normalizeHistoryLimit(10.4)).toBe(10)
  })

  it('clamps a request larger than the maximum', () => {
    expect(MAX_HISTORY_PAGE_LIMIT).toBe(500)
    expect(normalizeHistoryLimit(10_000_000)).toBe(500)
  })
})

describe('historyPageCacheKey', () => {
  it('separates pages by path, limit, cursor, and leaf', () => {
    const base = historyPageCacheKey('/tmp/a.jsonl', 20, undefined, undefined)
    expect(base).not.toBe(historyPageCacheKey('/tmp/b.jsonl', 20, undefined, undefined))
    expect(base).not.toBe(historyPageCacheKey('/tmp/a.jsonl', 40, undefined, undefined))
    expect(base).not.toBe(historyPageCacheKey('/tmp/a.jsonl', 20, 'entry-1', undefined))
    expect(base).not.toBe(historyPageCacheKey('/tmp/a.jsonl', 20, undefined, 'leaf-1'))
  })

  it('is stable for the same request', () => {
    expect(historyPageCacheKey('/tmp/a.jsonl', 20, 'entry-1', 'leaf-1')).toBe(
      historyPageCacheKey('/tmp/a.jsonl', 20, 'entry-1', 'leaf-1')
    )
  })
})
