import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { createModels, fauxProvider } from '@earendil-works/pi-ai'
import { Harness, MemoryStorage, createRegistry } from '@earendil-works/pi-durable'
import {
  importSessionFile,
  importSessionInto,
  readSessionEntries,
} from '../electron/pi/durable/importer'

/**
 * Phase 8.3: the importer walks the active leaf chain, keeps the source file untouched, and reports
 * what it could not carry over instead of inventing content.
 */

let dir = ''
let file = ''

const header = {
  type: 'session',
  version: 3,
  id: 'sess-uuid',
  cwd: '/tmp/ws',
  timestamp: '2026-10-01T00:00:00.000Z',
}

function entry(id: string, parentId: string | null, extra: Record<string, unknown>) {
  return { id, parentId, timestamp: '2026-10-01T00:00:01.000Z', ...extra }
}

function userMessage(id: string, parentId: string | null, text: string) {
  return entry(id, parentId, {
    type: 'message',
    message: { role: 'user', content: [{ type: 'text', text }], timestamp: 1 },
  })
}

function assistantMessage(id: string, parentId: string | null, text: string) {
  return entry(id, parentId, {
    type: 'message',
    message: { role: 'assistant', content: [{ type: 'text', text }], timestamp: 2 },
  })
}

async function writeSession(lines: unknown[]): Promise<void> {
  file = join(dir, 'session.jsonl')
  await writeFile(file, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf-8')
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'openpi-import-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('session importer', () => {
  it('imports the linear transcript in order', async () => {
    await writeSession([
      header,
      userMessage('a1', null, 'hello'),
      assistantMessage('a2', 'a1', 'hi there'),
    ])
    const result = await importSessionFile(file)
    expect(result.invalid).toBe(false)
    expect(result.messages.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(JSON.stringify(result.messages[1].message)).toContain('hi there')
    expect(result.counts).toEqual({ message: 2 })
  })

  it('follows only the active leaf chain when the session branched', async () => {
    await writeSession([
      header,
      userMessage('a1', null, 'first question'),
      assistantMessage('a2', 'a1', 'first answer'),
      userMessage('b1', 'a1', 'abandoned branch'),
      userMessage('c1', 'a2', 'chosen follow-up'),
      assistantMessage('c2', 'c1', 'chosen answer'),
    ])
    const result = await importSessionFile(file)
    const text = JSON.stringify(result.messages)
    expect(text).toContain('first question')
    expect(text).toContain('chosen follow-up')
    expect(text).toContain('chosen answer')
    // The abandoned branch must not be flattened into the transcript.
    expect(text).not.toContain('abandoned branch')
  })

  it('reports unsupported entry kinds through counts instead of dropping them silently', async () => {
    await writeSession([
      header,
      userMessage('a1', null, 'hello'),
      entry('a2', 'a1', { type: 'model_change', provider: 'anthropic', modelId: 'x' }),
      entry('a3', 'a2', { type: 'some_future_kind', payload: 1 }),
      assistantMessage('a4', 'a3', 'answer'),
    ])
    const result = await importSessionFile(file)
    expect(result.messages).toHaveLength(2)
    expect(result.counts).toMatchObject({ message: 2, model_change: 1, some_future_kind: 1 })
  })

  it('never modifies the source file', async () => {
    await writeSession([
      header,
      userMessage('a1', null, 'hello'),
      assistantMessage('a2', 'a1', 'hi'),
    ])
    const before = await readFile(file, 'utf-8')
    await importSessionFile(file)
    expect(await readFile(file, 'utf-8')).toBe(before)
  })

  it('is idempotent: importing twice yields the same transcript', async () => {
    await writeSession([
      header,
      userMessage('a1', null, 'hello'),
      assistantMessage('a2', 'a1', 'hi'),
    ])
    const first = await importSessionFile(file)
    const second = await importSessionFile(file)
    expect(second.messages).toEqual(first.messages)
  })

  it('flags a file without a session header as invalid', async () => {
    await writeSession([userMessage('a1', null, 'orphan')])
    const result = await importSessionFile(file)
    expect(result.invalid).toBe(true)
    expect(result.messages).toEqual([])
  })

  it('flags a missing file instead of throwing', async () => {
    const result = await importSessionFile(join(dir, 'nope.jsonl'))
    expect(result.invalid).toBe(true)
    expect(result.skipped[0]).toContain('does not exist')
  })

  it('counts unparseable lines and keeps the readable ones', async () => {
    file = join(dir, 'mixed.jsonl')
    const content = [
      header,
      userMessage('a1', null, 'hello'),
      '{not json',
      assistantMessage('a2', 'a1', 'hi'),
    ]
      .map((line) => (typeof line === 'string' ? line : JSON.stringify(line)))
      .join('\n')
    await writeFile(file, `${content}\n`, 'utf-8')
    const { invalid } = await readSessionEntries(file)
    expect(invalid).toBe(1)
    const result = await importSessionFile(file)
    expect(result.messages).toHaveLength(2)
    expect(result.skipped.join(' ')).toContain('unparseable')
  })
})

describe('session importer into a durable conversation', () => {
  it('writes the transcript as passive entries without running a model', async () => {
    await writeSession([
      header,
      userMessage('a1', null, 'hello'),
      assistantMessage('a2', 'a1', 'imported answer'),
    ])
    const faux = fauxProvider()
    const models = createModels()
    models.setProvider(faux.provider)
    const harness = await Harness.open(
      new MemoryStorage(),
      { models, registry: createRegistry() },
      BACKGROUND_CONTEXT
    )
    try {
      const root = await harness.root(BACKGROUND_CONTEXT, {
        agent: { model: { provider: faux.getModel().provider, modelId: faux.getModel().id } },
      })
      const result = await importSessionInto(
        root as unknown as {
          submit: (draft: { type: 'write'; entry: unknown }, context: unknown) => Promise<unknown>
        },
        file,
        BACKGROUND_CONTEXT
      )
      expect(result.messages).toHaveLength(2)
      // No provider request: a `write` submission is inert.
      expect(faux.state.callCount).toBe(0)
      const view = await root.context(BACKGROUND_CONTEXT)
      const kinds = view.entries.map((entry) => entry.kind)
      expect(kinds).toContain('pi.user')
      expect(kinds).toContain('pi.assistant')
      expect(JSON.stringify(view.entries)).toContain('imported answer')
    } finally {
      await harness.close(BACKGROUND_CONTEXT)
    }
  })
})
