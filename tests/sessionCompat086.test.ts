import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  readSessionHistoryPage,
  usageTotals,
  type SessionEntry,
} from '../electron/session/sessionEntries'
import { buildSessionTree } from '../electron/session/sessionTreeBuilder'
import { entryToTreeNode } from '../electron/session/sessionTree'
import { buildSessionTrajectory } from '../electron/session/sessionTrajectory'
import { usageMetricsByEntryId } from '../electron/session/sessionUsage'
import { USAGE_INDEX_VERSION } from '../electron/session/sessionIndex'

const T0 = '2026-09-20T10:00:00.000Z'

function userEntry(id: string, parentId: string | null, text: string): SessionEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: T0,
    message: { role: 'user', content: text, timestamp: 1 },
  }
}

function assistantEntry(id: string, parentId: string | null): SessionEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-09-20T10:00:05.000Z',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      provider: 'test-provider',
      model: 'turn-model',
      usage: {
        input: 100,
        output: 20,
        cacheRead: 5,
        cacheWrite: 0,
        totalTokens: 125,
        cost: { total: 0.01, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
      stopReason: 'stop',
      timestamp: 2,
    },
  }
}

/** The Pi 0.86 UsageEntry shape (kind "cache_warm" from the cache warmer). */
function warmEntry(id: string, parentId: string | null): SessionEntry {
  return {
    type: 'usage',
    id,
    parentId,
    timestamp: '2026-09-20T10:00:30.000Z',
    kind: 'cache_warm',
    provider: 'test-provider',
    model: 'test-model',
    usage: {
      input: 0,
      output: 1,
      cacheRead: 9000,
      cacheWrite: 0,
      totalTokens: 9001,
      cost: { total: 0.0002, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  }
}

function systemMessageEntry(id: string, parentId: string | null): SessionEntry {
  return {
    type: 'message',
    id,
    parentId,
    timestamp: '2026-09-20T10:00:10.000Z',
    message: { role: 'system', content: 'extra instructions', timestamp: 3 },
  }
}

function compactionWithUsage(id: string, parentId: string | null): SessionEntry {
  return {
    type: 'compaction',
    id,
    parentId,
    timestamp: '2026-09-20T10:00:20.000Z',
    summary: 'summarized',
    firstKeptEntryId: 'u1',
    tokensBefore: 1000,
    usage: {
      input: 50,
      output: 10,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 60,
      cost: { total: 0.003, input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    },
  }
}

describe('usageTotals with standalone usage entries', () => {
  it('counts a usage entry on its own, exactly once', () => {
    const totals = usageTotals([warmEntry('w1', 'a1')])
    expect(totals).toEqual({
      inputTokens: 0,
      outputTokens: 1,
      cacheReadTokens: 9000,
      cacheWriteTokens: 0,
      cost: 0.0002,
    })
  })

  it('adds usage entries to assistant and compaction usage without double counting', () => {
    const entries = [
      userEntry('u1', null, 'hi'),
      assistantEntry('a1', 'u1'),
      warmEntry('w1', 'a1'),
      compactionWithUsage('c1', 'w1'),
    ]
    const totals = usageTotals(entries)
    expect(totals.inputTokens).toBe(150)
    expect(totals.outputTokens).toBe(31)
    expect(totals.cacheReadTokens).toBe(9005)
    expect(totals.cacheWriteTokens).toBe(0)
    expect(totals.cost).toBeCloseTo(0.0132, 6)
  })
})

describe('usage index version', () => {
  it('was bumped so existing sessions re-index standalone usage rows', () => {
    // 7 predates 0.86 usage entries; 10 also reclassifies non-assistant
    // message rows so turn counts remain assistant-only.
    expect(USAGE_INDEX_VERSION).toBe(10)
  })

  it('gives a usage entry its own row under the model on the entry', () => {
    const modelChange: SessionEntry = {
      type: 'model_change',
      id: 'mc1',
      parentId: null,
      timestamp: T0,
      provider: 'other-provider',
      modelId: 'other-model',
    }
    const metrics = usageMetricsByEntryId([modelChange, warmEntry('w1', 'mc1')])
    const row = metrics.get('w1')
    expect(row).toMatchObject({
      inputTokens: 0,
      outputTokens: 1,
      cacheReadTokens: 9000,
      cacheWriteTokens: 0,
      totalTokens: 9001,
      durationMs: 0,
      cost: 0.0002,
      model: 'test-model',
      provider: 'test-provider',
    })
    // Its own row type, so it never counts as a turn.
    expect(row?.rowType).toBeUndefined()
  })

  it('gives system messages no usage row', () => {
    const metrics = usageMetricsByEntryId([
      userEntry('u1', null, 'hi'),
      systemMessageEntry('s1', 'u1'),
    ])
    expect(metrics.has('s1')).toBe(false)
  })
})

describe('tree read model with 0.86 entries', () => {
  it('never labels a system message as user or assistant', () => {
    const node = entryToTreeNode(systemMessageEntry('s1', null))
    expect(node.type).toBe('message')
    expect(node.role).toBeUndefined()
    expect(node.contentPreview).toBe('extra instructions')
    expect(entryToTreeNode(userEntry('u1', null, 'hi')).role).toBe('user')
    expect(entryToTreeNode(assistantEntry('a1', null)).role).toBe('assistant')
  })

  it('keeps a conversation visible when the leading system message is the root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat086-system-root-'))
    const file = path.join(dir, 'session.jsonl')
    const header = JSON.stringify({ type: 'session', version: 3, id: 'sess', cwd: '/ws' })
    fs.writeFileSync(
      file,
      [
        header,
        JSON.stringify(systemMessageEntry('sys1', null)),
        JSON.stringify(userEntry('u1', 'sys1', 'hi')),
        JSON.stringify(assistantEntry('a1', 'u1')),
      ].join('\n')
    )

    const result = buildSessionTree(file)
    expect(result.branches[0]?.nodes.map((node) => node.id)).toEqual(['u1', 'a1'])
    expect(result.activeLeafId).toBe('a1')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('keeps every branch attached to a hidden system root', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat086-root-'))
    const file = path.join(dir, 'session.jsonl')
    const header = JSON.stringify({ type: 'session', version: 3, id: 'sess', cwd: '/ws' })
    fs.writeFileSync(
      file,
      [
        header,
        JSON.stringify(systemMessageEntry('sys1', null)),
        JSON.stringify(userEntry('u1', 'sys1', 'first branch')),
        JSON.stringify(userEntry('u2', 'sys1', 'second branch')),
      ].join('\n')
    )

    const result = buildSessionTree(file)

    expect(result.branches.map((branch) => branch.leafId).sort()).toEqual(['u1', 'u2'])
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('splices usage and system entries out of branches while keeping the chain', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat086-tree-'))
    const file = path.join(dir, 'session.jsonl')
    const header = JSON.stringify({ type: 'session', version: 3, id: 'sess', cwd: '/ws' })
    const line = (entry: SessionEntry): string => JSON.stringify(entry)
    fs.writeFileSync(
      file,
      [
        header,
        line(userEntry('u1', null, 'hi')),
        line(assistantEntry('a1', 'u1')),
        line(warmEntry('w1', 'a1')),
        line(systemMessageEntry('s1', 'w1')),
        line(userEntry('u2', 's1', 'again')),
      ].join('\n')
    )

    const result = buildSessionTree(file)
    expect(result.forkPoints).toEqual([])
    expect(result.branches).toHaveLength(1)
    expect(result.branches[0]?.nodes.map((node) => node.id)).toEqual(['u1', 'a1', 'u2'])
    expect(result.activeLeafId).toBe('u2')
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('resolves a usage-file leaf to the nearest conversation entry', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat086-leaf-'))
    const file = path.join(dir, 'session.jsonl')
    const header = JSON.stringify({ type: 'session', version: 3, id: 'sess', cwd: '/ws' })
    fs.writeFileSync(
      file,
      [
        header,
        JSON.stringify(userEntry('u1', null, 'hi')),
        JSON.stringify(assistantEntry('a1', 'u1')),
        JSON.stringify(warmEntry('w1', 'a1')),
      ].join('\n')
    )

    const result = buildSessionTree(file)
    expect(result.activeLeafId).toBe('a1')
    expect(result.branches[0]?.nodes.map((node) => node.id)).toEqual(['u1', 'a1'])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('trajectory read model with 0.86 entries', () => {
  it('keeps 0.86 metadata entries out of ledger rows and off the navigable path', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat086-traj-'))
    const file = path.join(dir, 'session.jsonl')
    const header = JSON.stringify({ type: 'session', version: 3, id: 'sess', cwd: '/ws' })
    fs.writeFileSync(
      file,
      [
        header,
        JSON.stringify(userEntry('u1', null, 'hi')),
        JSON.stringify(assistantEntry('a1', 'u1')),
        JSON.stringify(warmEntry('w1', 'a1')),
        JSON.stringify(systemMessageEntry('s1', 'w1')),
        JSON.stringify(userEntry('u2', 's1', 'again')),
      ].join('\n')
    )

    const result = buildSessionTrajectory(file, 'u2')
    expect(result.activeLeafId).toBe('u2')
    expect(result.rows.map((row) => row.entryId)).toEqual(['u1', 'a1', 'u2'])
    expect(result.rows.map((row) => row.role)).toEqual(['user', 'assistant', 'user'])
    // The turn's own metrics survive the splice.
    expect(result.rows.find((row) => row.entryId === 'a1')?.cost).toBeCloseTo(0.01, 6)
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('history pages tolerate 0.86 entries on the branch', () => {
  it('renders only user and assistant messages from a 0.86 session file', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compat086-hist-'))
    const file = path.join(dir, 'session.jsonl')
    const header = JSON.stringify({ type: 'session', version: 3, id: 'sess', cwd: '/ws' })
    fs.writeFileSync(
      file,
      [
        header,
        JSON.stringify(userEntry('u1', null, 'hi')),
        JSON.stringify(assistantEntry('a1', 'u1')),
        JSON.stringify(warmEntry('w1', 'a1')),
        JSON.stringify(systemMessageEntry('s1', 'w1')),
        JSON.stringify(userEntry('u2', 's1', 'again')),
      ].join('\n')
    )

    const page = await readSessionHistoryPage(file, {})
    expect(page.messages.map((message) => message.id)).toEqual(['u1', 'a1', 'u2'])
    expect(page.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
