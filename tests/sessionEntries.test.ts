import { describe, expect, it } from 'vitest'
import type { SessionEntry } from '../electron/session/sessionEntries'
import {
  conversationMessageCount,
  DEFAULT_HISTORY_PAGE_LIMIT,
  MAX_HISTORY_PAGE_LIMIT,
  historyPageCacheKey,
  normalizeHistoryLimit,
  normalizeSessionEntry,
  parseSessionEntries,
  usageTotals,
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

describe('conversationMessageCount', () => {
  it('excludes persisted system metadata but preserves other message entries', () => {
    const entries: SessionEntry[] = [
      {
        type: 'message',
        id: 'system',
        parentId: null,
        timestamp: '',
        message: { role: 'system' },
      },
      {
        type: 'message',
        id: 'user',
        parentId: 'system',
        timestamp: '',
        message: { role: 'user' },
      },
      {
        type: 'message',
        id: 'tool',
        parentId: 'user',
        timestamp: '',
        message: { role: 'toolResult' },
      },
      { type: 'usage', id: 'warm', parentId: 'tool', timestamp: '' },
    ]
    expect(conversationMessageCount(entries)).toBe(2)
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

describe('unknown entry types from newer Pi versions', () => {
  // Pi 0.87 added `context_edit` to the SessionEntry union. OpenPi's parser is
  // duck-typed on purpose: entry kinds it does not model yet must parse without
  // crashing, stay out of the visible conversation, and contribute no usage.
  const content = [
    JSON.stringify({ type: 'session', id: 'uuid-1', cwd: '/w', version: 3 }),
    JSON.stringify({
      type: 'message',
      id: 'aaa00000',
      parentId: null,
      timestamp: '2026-01-01T00:00:00.000Z',
      message: { role: 'user', content: 'hi' },
    }),
    JSON.stringify({
      type: 'context_edit',
      id: 'bbb00000',
      parentId: 'aaa00000',
      timestamp: '2026-01-01T00:00:01.000Z',
      targetId: 'aaa00000',
      replacement: null,
    }),
    JSON.stringify({
      type: 'message',
      id: 'ccc00000',
      parentId: 'bbb00000',
      timestamp: '2026-01-01T00:00:02.000Z',
      message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    }),
  ].join('\n')

  it('parses a context_edit entry without dropping or crashing', () => {
    const entries = parseSessionEntries(content)
    expect(entries.map((entry) => entry.type)).toEqual([
      'session',
      'message',
      'context_edit',
      'message',
    ])
    const contextEdit = entries[2]
    if (!contextEdit) throw new Error('Expected context_edit entry')
    expect(normalizeSessionEntry(contextEdit)).toMatchObject({
      type: 'context_edit',
      parentId: 'aaa00000',
    })
  })

  it('keeps unknown entries out of the conversation count and usage totals', () => {
    const entries = parseSessionEntries(content)
      .map((entry) => normalizeSessionEntry(entry))
      .filter((entry) => entry !== null)
    expect(conversationMessageCount(entries)).toBe(2)
    expect(usageTotals(entries)).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0,
    })
  })
})
