import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { sessionEventSchema } from '../src/lib/ipc'
import { applySessionEvent } from '../src/lib/sessionEvents'
import type { Message } from '../src/types/session'
import type { SidecarMessage } from '../electron/pi/sidecarTypes'
import { prompt, setup, useSessionRoot } from './helpers/durableSession'
import { schemaFailures } from './helpers/wireEvents'

/**
 * Phase 8.3m: the `compact` command on a durable session, checked the way the renderer consumes it:
 * every event through `sessionEventSchema`, the result through the real reducer.
 */

useSessionRoot()

const LOW = { keepRecentTokens: 1 }

type Sent = Extract<SidecarMessage, { type: 'session_event' }>

function events(sent: SidecarMessage[]): Record<string, unknown>[] {
  return sent.filter((m): m is Sent => m.type === 'session_event').map((m) => ({ ...m.event }))
}

function render(sent: SidecarMessage[]): Message[] {
  return events(sent).reduce<Message[]>((messages, event) => {
    const parsed = sessionEventSchema.parse(event)
    return applySessionEvent(messages, parsed)
  }, [])
}

describe('durable compact', () => {
  async function compacted() {
    const t = await setup({
      answers: ['answer one', 'answer two', 'SUMMARY OF WORK'],
      compaction: LOW,
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    await t.sessions.handleCommand(prompt('q one'))
    await t.sessions.handleCommand(prompt('q two'))
    await t.sessions.handleCommand({ type: 'compact', requestId: 'c1' })
    // The event feed is asynchronous; let the closing event land.
    await new Promise((resolve) => setTimeout(resolve, 200))
    return t
  }

  it('answers compact_result and shows the summary as a compaction card, not a chat bubble', async () => {
    const t = await compacted()
    try {
      expect(t.sent.filter((m) => m.type === 'compact_result')).toEqual([
        { type: 'compact_result', requestId: 'c1' },
      ])
      expect(schemaFailures(events(t.sent))).toEqual([])

      const messages = render(t.sent)
      const card = messages.find((m) => m.role === 'system' && m.kind === 'compaction')
      expect(card).toMatchObject({ done: true, summary: 'SUMMARY OF WORK' })
      // The summary is a user-role entry in pi-durable; it must not also appear as something the user said.
      const users = messages.filter((m) => m.role === 'user')
      expect(JSON.stringify(users)).not.toContain('conversation history before')
      expect(JSON.stringify(users)).not.toContain('SUMMARY OF WORK')
    } finally {
      await t.sessions.stop()
    }
  })

  it('exports the compaction and keeps the earlier turns in the file', async () => {
    const t = await compacted()
    try {
      const text = await readFile(t.identity.sessionFile, 'utf8')
      const lines = text
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l) as { type: string })
      expect(lines.filter((l) => l.type === 'compaction')).toHaveLength(1)
      expect(text).toContain('q one')
      expect(text).toContain('answer one')
    } finally {
      await t.sessions.stop()
    }
  })

  it('reports nothing to compact as an error, with a failed card and no compact_result', async () => {
    const t = await setup({ answers: ['one'] })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('hello'))
      await t.sessions.handleCommand({ type: 'compact', requestId: 'c2' })
      await new Promise((resolve) => setTimeout(resolve, 200))

      expect(t.sent.filter((m) => m.type === 'compact_result')).toEqual([])
      expect(t.sent.filter((m) => m.type === 'error')).toEqual([
        { type: 'error', requestId: 'c2', message: 'Nothing to compact (session too small)' },
      ])
      const card = render(t.sent).find((m) => m.role === 'system' && m.kind === 'compaction')
      expect(card).toMatchObject({ done: true })
      expect(JSON.stringify(card)).toContain('Nothing to compact')
    } finally {
      await t.sessions.stop()
    }
  })

  it('keeps working after a compaction', async () => {
    const t = await setup({
      answers: ['answer one', 'answer two', 'SUMMARY', 'answer three'],
      compaction: LOW,
    })
    await t.sessions.start('/work', { workspaceTrusted: false })
    try {
      await t.sessions.handleCommand(prompt('q one'))
      await t.sessions.handleCommand(prompt('q two'))
      await t.sessions.handleCommand({ type: 'compact', requestId: 'c3' })
      await t.sessions.handleCommand(prompt('q three'))
      await t.sessions.handleCommand({ type: 'copy_last_assistant_text', requestId: 'l1' })
      expect(t.sent.filter((m) => m.type === 'last_assistant_text_result').at(-1)).toMatchObject({
        text: 'answer three',
      })
    } finally {
      await t.sessions.stop()
    }
  })
})
