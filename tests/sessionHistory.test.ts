import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readSessionHistoryPage } from '../electron/session/sessionEntries'
import { appendHistoryEntry, type HistoryReadState } from '../electron/session/sessionHistory'
import { sessionHistoryPageSchema, type SessionHistoryMessage } from '../src/lib/ipc'
import { applySessionEvent } from '../src/lib/sessionEvents'
import type { Message, ToolCard } from '../src/types/session'
import {
  CODEMODE_CALL_ID,
  CODEMODE_RESULT_TEXT,
  FINAL_TEXT,
  NESTED_CALL_ID,
  codemodeTurnEvents,
  persistedCodemodeEntries,
} from './helpers/nestedToolEvents'

const tempDirs: string[] = []
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function mapEntries(entries = persistedCodemodeEntries()): SessionHistoryMessage[] {
  const messages: SessionHistoryMessage[] = []
  const state: HistoryReadState = { lastUserTimestampMs: null }
  for (const entry of entries) appendHistoryEntry(messages, entry, state)
  return messages
}

const cardsOf = (messages: ReadonlyArray<Message | SessionHistoryMessage>): ToolCard[] =>
  messages.flatMap((message) => ('toolCards' in message ? message.toolCards : []))

describe('resumed history of a codemode turn with persisted nestedCalls', () => {
  it('maps the codemode toolResult onto its call card and drops no other message', () => {
    const messages = mapEntries()

    expect(messages.map((m) => [m.role, m.text])).toEqual([
      ['user', 'Write nested.txt'],
      ['assistant', ''],
      ['assistant', FINAL_TEXT],
    ])
    expect(cardsOf(messages)).toEqual([
      expect.objectContaining({
        toolCallId: CODEMODE_CALL_ID,
        toolName: 'codemode',
        output: CODEMODE_RESULT_TEXT,
        isError: false,
        streaming: false,
      }),
    ])
  })

  it('never turns the nested record into a tool card or a stray message', () => {
    const messages = mapEntries()

    expect(cardsOf(messages).some((card) => card.toolCallId === NESTED_CALL_ID)).toBe(false)
    expect(messages.some((m) => m.id.includes(NESTED_CALL_ID))).toBe(false)
  })

  it('survives records that lost arguments or are incomplete', () => {
    const entries = persistedCodemodeEntries({
      isError: true,
      nestedCalls: {
        calls: [
          {
            id: `${CODEMODE_CALL_ID}/1`,
            name: 'write',
            status: 'unfinished',
            argumentsBytes: 40_000,
          },
          {
            id: `${CODEMODE_CALL_ID}/2`,
            name: 'bash',
            status: 'error',
            error: 'boom',
            durationMs: 1,
          },
        ],
        complete: false,
      },
    })

    expect(cardsOf(mapEntries(entries))).toEqual([
      expect.objectContaining({ toolCallId: CODEMODE_CALL_ID, isError: true }),
    ])
  })

  it('reads the same card through the real page reader and passes the IPC schema', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openpi-nested-history-'))
    tempDirs.push(dir)
    const file = path.join(dir, 'session.jsonl')
    const header = { type: 'session', version: 3, id: 'nested-session', cwd: dir }
    const lines = [header, ...persistedCodemodeEntries()].map((entry) => JSON.stringify(entry))
    fs.writeFileSync(file, `${lines.join('\n')}\n`)

    const page = await readSessionHistoryPage(file, { limit: 50 })

    expect(sessionHistoryPageSchema.safeParse(page).success).toBe(true)
    expect(cardsOf(page.messages).map((card) => card.toolCallId)).toEqual([CODEMODE_CALL_ID])
    expect(page.messages.at(-1)?.text).toBe(FINAL_TEXT)
  })
})

describe('live tool rail and resumed tool rail agree for a codemode turn', () => {
  it('shows the same cards live as after the history reloads from disk', () => {
    const live = codemodeTurnEvents().reduce<Message[]>(
      (messages, event) => applySessionEvent(messages, event),
      []
    )
    const withoutLiveOnlyFields = (cards: ToolCard[]) =>
      cards.map(({ startedAt: _startedAt, ...card }) => card)

    expect(withoutLiveOnlyFields(cardsOf(live))).toEqual(
      withoutLiveOnlyFields(cardsOf(mapEntries()))
    )
  })
})

describe('history messages carry their timestamp for history/live dedupe (#71)', () => {
  const entry = (id: string, message: Record<string, unknown>) => ({
    type: 'message',
    id,
    parentId: null,
    timestamp: '2023-11-14T22:13:20.000Z',
    message,
  })

  it('stamps user and assistant messages with the payload timestamp', () => {
    const messages = mapEntries([
      entry('e1', { role: 'user', content: 'hi', timestamp: 1_700_000_000_000 }),
      entry('e2', {
        role: 'assistant',
        content: [{ type: 'text', text: 'yo' }],
        timestamp: 1_700_000_001_000,
      }),
    ])

    expect(messages.map((message) => message.timestamp)).toEqual([
      1_700_000_000_000, 1_700_000_001_000,
    ])
  })

  it('stamps a bash execution message too', () => {
    const messages = mapEntries([
      entry('e1', {
        role: 'bashExecution',
        command: 'ls',
        output: 'a',
        exitCode: 0,
        timestamp: 1_700_000_002_000,
      }),
    ])

    expect(messages[0]?.timestamp).toBe(1_700_000_002_000)
  })

  it('falls back to the entry timestamp when the payload has none', () => {
    const messages = mapEntries([entry('e1', { role: 'user', content: 'hi' })])

    expect(messages[0]?.timestamp).toBe(Date.parse('2023-11-14T22:13:20.000Z'))
  })
})
