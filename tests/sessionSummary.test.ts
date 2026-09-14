import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { SessionEntry } from '../electron/session/sessionEntries'
import {
  emptyHistoryPage,
  firstUserMessage,
  latestModel,
  latestSessionName,
  parseSessionEntries,
  parseSessionFile,
  usageTotals,
} from '../electron/session/sessionEntries'

let root = ''

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-summary-'))
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

/** Usage fields as Pi writes them, plus the aliases it never persists. */
interface UsageFields {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  totalTokens?: number
  cost?: number | { total?: number }
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/** Fields the fixtures vary; the rest of an entry is fixed by `entry()`. */
interface EntryFields {
  message?: { role: string; content?: unknown; usage?: UsageFields }
  thinkingLevel?: string
  result?: { tokensBefore?: number }
  name?: string
  modelId?: string
}

function entry(id: string, type: string, fields: EntryFields = {}): SessionEntry {
  return { type, id, parentId: null, timestamp: '2026-09-14T10:00:00.000Z', ...fields }
}

function assistant(usage: UsageFields): SessionEntry {
  return entry('a', 'message', { message: { role: 'assistant', content: 'ok', usage } })
}

describe('usageTotals', () => {
  it('sums the usage Pi reports on assistant messages', () => {
    const totals = usageTotals([
      assistant({ input: 10, output: 4, cacheRead: 2, cacheWrite: 1, cost: { total: 0.5 } }),
      assistant({ input: 5, output: 1, cacheRead: 0, cacheWrite: 0, cost: { total: 0.25 } }),
    ])

    expect(totals).toEqual({
      inputTokens: 15,
      outputTokens: 5,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
      cost: 0.75,
    })
  })

  it('ignores anything that is not an assistant message', () => {
    const totals = usageTotals([
      // A user message carrying usage is unusual, but the role check is what keeps
      // it out of the totals, so the fixture has to have one.
      entry('u', 'message', { message: { role: 'user', content: 'hi', usage: { input: 99 } } }),
      entry('t', 'thinking_level_change', { thinkingLevel: 'high' }),
      entry('c', 'compaction', { result: { tokensBefore: 100 } }),
    ])

    expect(totals.inputTokens).toBe(0)
    expect(totals.cost).toBe(0)
  })

  it('counts only the field names Pi writes', () => {
    // Pi's Usage type is input/output/cacheRead/cacheWrite/totalTokens; the
    // *Tokens aliases some providers use internally are never persisted, so a
    // usage object that only carries them contributes nothing.
    const totals = usageTotals([
      assistant({ inputTokens: 99, outputTokens: 99, cacheReadTokens: 99, cacheWriteTokens: 99 }),
    ])

    expect(totals.inputTokens).toBe(0)
    expect(totals.outputTokens).toBe(0)
  })

  it('reads a numeric cost and tolerates a missing one', () => {
    expect(usageTotals([assistant({ input: 1, cost: 0.125 })]).cost).toBe(0.125)
    expect(usageTotals([assistant({ input: 1 })]).cost).toBe(0)
  })
})

describe('latestModel', () => {
  it('reports the last model change', () => {
    const entries = [
      entry('m1', 'model_change', { modelId: 'claude-sonnet-5' }),
      entry('a', 'message', { message: { role: 'assistant', content: 'ok' } }),
      entry('m2', 'model_change', { modelId: 'gpt-5.4' }),
    ]

    expect(latestModel(entries)).toBe('gpt-5.4')
  })

  it('skips model changes without a model id and reports nothing when there are none', () => {
    expect(latestModel([entry('m', 'model_change', {}), entry('a', 'message')])).toBe('')
    expect(latestModel([])).toBe('')
  })
})

describe('latestSessionName', () => {
  it('reports the last non-blank name', () => {
    const entries = [
      entry('s1', 'session_info', { name: 'First' }),
      entry('s2', 'session_info', { name: '   ' }),
      entry('s3', 'session_info', { name: '  Renamed  ' }),
    ]

    expect(latestSessionName(entries)).toBe('Renamed')
  })

  it('reports nothing when no name was ever set', () => {
    expect(latestSessionName([entry('a', 'message')])).toBe('')
  })
})

describe('firstUserMessage', () => {
  it('reports the first user message, truncated to 140 characters', () => {
    const entries = [
      entry('a1', 'message', { message: { role: 'assistant', content: 'hello' } }),
      entry('u1', 'message', { message: { role: 'user', content: '  the first prompt  ' } }),
      entry('u2', 'message', { message: { role: 'user', content: 'later' } }),
    ]

    expect(firstUserMessage(entries)).toBe('the first prompt')
    expect(
      firstUserMessage([
        entry('u', 'message', { message: { role: 'user', content: 'x'.repeat(200) } }),
      ])
    ).toHaveLength(140)
  })

  it('reports nothing without a user message', () => {
    expect(firstUserMessage([entry('a', 'message', { message: { role: 'assistant' } })])).toBe('')
    expect(firstUserMessage([])).toBe('')
  })
})

describe('emptyHistoryPage', () => {
  it('carries the requested limit and no cursor', () => {
    expect(emptyHistoryPage(25)).toEqual({
      messages: [],
      hasMoreBefore: false,
      nextBeforeEntryId: null,
      limit: 25,
    })
  })
})

describe('parseSessionEntries', () => {
  it('keeps records with a type and skips everything else', () => {
    const content = [
      JSON.stringify({ type: 'session', id: 'session-1' }),
      '',
      '   ',
      'not json',
      JSON.stringify({ id: 'no-type' }),
      JSON.stringify(['array']),
      JSON.stringify({ type: 'message', id: 'a' }),
    ].join('\n')

    expect(parseSessionEntries(content).map((item) => item.type)).toEqual(['session', 'message'])
  })
})

describe('parseSessionFile', () => {
  it('separates the header from the entries', () => {
    const file = path.join(root, 'session.jsonl')
    fs.writeFileSync(
      file,
      `${[
        JSON.stringify({ type: 'session', version: 3, id: 'session-1', cwd: root }),
        JSON.stringify({ type: 'message', id: 'a', parentId: null, timestamp: 't' }),
      ].join('\n')}\n`
    )

    const { header, entries } = parseSessionFile(file)

    expect(header?.id).toBe('session-1')
    expect(entries.map((item) => item.id)).toEqual(['a'])
  })

  it('reports an empty result when the file cannot be read', () => {
    expect(parseSessionFile(path.join(root, 'missing.jsonl'))).toEqual({
      header: null,
      entries: [],
    })
  })
})
