import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fauxAssistantMessage, fauxProvider, fauxText } from '@earendil-works/pi-ai'
import { SessionManager } from '@earendil-works/pi-coding-agent'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { openDurableHarness } from '../electron/pi/durable/harness'
import { parseSessionFile } from '../electron/session/sessionEntries'

/**
 * Phase 8.3l: a compaction must not erase history from the export. The active context drops
 * everything before the cut; the file is the archive, so it must keep it and describe the
 * compaction the way the SDK does, which the SDK itself then rebuilds correctly.
 */

let root = ''
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'openpi-compaction-'))
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

const header = { sessionId: 'sess-c', cwd: '/work', startedAt: '2026-10-27T00:00:00.000Z' }
const reply = (text: string) =>
  fauxAssistantMessage([fauxText(text)], { stopReason: 'stop' as const })

async function open(
  responses: ReturnType<typeof reply>[],
  compaction?: { keepRecentTokens: number }
) {
  const faux = fauxProvider()
  faux.setResponses(responses)
  return openDurableHarness({
    backend: 'memory',
    model: { provider: faux.getModel().provider, modelId: faux.getModel().id },
    registerProviders: (models) => models.setProvider(faux.provider),
    tools: false,
    policy: false,
    compaction,
  })
}

const lineSchema = z.object({
  type: z.string(),
  id: z.string(),
  // The session header line has no parent at all; every other line has one or null.
  parentId: z.string().nullable().optional(),
  summary: z.string().optional(),
  firstKeptEntryId: z.string().optional(),
  message: z.object({ role: z.string(), content: z.unknown() }).optional(),
})
type Line = z.infer<typeof lineSchema>

async function lines(path: string): Promise<Line[]> {
  const text = await readFile(path, 'utf8')
  return text
    .trim()
    .split('\n')
    .map((line) => lineSchema.parse(JSON.parse(line)))
}

const textOf = (line: Line) => JSON.stringify(line.message?.content ?? '')

describe('harness.compact', () => {
  it('reports nothing to compact when the conversation is too small', async () => {
    const h = await open([reply('one')])
    try {
      await h.prompt('hello')
      expect(await h.compact()).toEqual({ status: 'nothing' })
    } finally {
      await h.close()
    }
  })

  it('compacts and shrinks the model context', async () => {
    const h = await open([reply('one'), reply('two'), reply('SUMMARY OF WORK')], {
      keepRecentTokens: 1,
    })
    try {
      await h.prompt('q one')
      await h.prompt('q two')
      const before = (await h.stats()).messageCount
      expect(await h.compact('focus on tests')).toEqual({ status: 'compacted' })
      expect((await h.stats()).messageCount).toBeLessThan(before)
    } finally {
      await h.close()
    }
  })
})

describe('export across a compaction', () => {
  async function compacted() {
    const h = await open([reply('answer one'), reply('answer two'), reply('SUMMARY OF WORK')], {
      keepRecentTokens: 1,
    })
    await h.prompt('q one')
    await h.prompt('q two')
    await h.compact()
    const path = join(root, 'c.jsonl')
    await h.exportSession(path, header)
    return { h, path }
  }

  it('keeps the whole history and adds one SDK-style compaction line', async () => {
    const { h, path } = await compacted()
    try {
      const all = await lines(path)
      const text = all.map(textOf).join('\n')
      for (const kept of ['q one', 'answer one', 'q two', 'answer two'])
        expect(text).toContain(kept)

      const compactions = all.filter((line) => line.type === 'compaction')
      expect(compactions).toHaveLength(1)
      // The raw summary, without pi-durable's wrapper, and not also written as a message.
      expect(compactions[0]?.summary).toBe('SUMMARY OF WORK')
      expect(text).not.toContain('conversation history before')
    } finally {
      await h.close()
    }
  })

  it('points firstKeptEntryId at the first entry the compaction kept', async () => {
    const { h, path } = await compacted()
    try {
      const all = await lines(path)
      const compaction = all.find((line) => line.type === 'compaction')
      const kept = all.find((line) => line.id === compaction?.firstKeptEntryId)
      expect(kept?.type).toBe('message')
      expect(kept ? textOf(kept) : '').toContain('answer two')
    } finally {
      await h.close()
    }
  })

  it('is rebuilt by the real SDK into the same compacted context', async () => {
    const { h, path } = await compacted()
    try {
      const context = SessionManager.open(path, undefined, '/work').buildSessionContext()
      const text = JSON.stringify(context.messages)
      expect(text).toContain('SUMMARY OF WORK')
      expect(text).toContain('answer two')
      // Compacted away: still on disk, but not in the context the model would get.
      expect(text).not.toContain('q one')
      expect(text).not.toContain('answer one')
    } finally {
      await h.close()
    }
  })

  it('stays a valid linear chain the sidebar readers accept, and survives more turns', async () => {
    const h = await open(
      [reply('answer one'), reply('answer two'), reply('SUMMARY'), reply('answer three')],
      { keepRecentTokens: 1 }
    )
    try {
      await h.prompt('q one')
      await h.prompt('q two')
      await h.compact()
      await h.prompt('q three')
      const path = join(root, 'more.jsonl')
      await h.exportSession(path, header)

      const parsed = parseSessionFile(path)
      expect(parsed.header?.type).toBe('session')
      parsed.entries.slice(1).forEach((entry, index) => {
        expect(entry.parentId).toBe(parsed.entries[index]?.id)
      })
      const all = await lines(path)
      const order = all.map((line) =>
        line.type === 'compaction' ? 'C' : textOf(line).slice(0, 12)
      )
      expect(order.indexOf('C')).toBeGreaterThan(order.findIndex((t) => t.includes('answer two')))
      expect(order.findIndex((t) => t.includes('q three'))).toBeGreaterThan(order.indexOf('C'))
    } finally {
      await h.close()
    }
  })
})
