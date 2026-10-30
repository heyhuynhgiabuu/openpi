import { createRoot, createSignal } from 'solid-js'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionHistory } from '../src/hooks/useSessionHistory'
import type { SessionHistoryMessage, SessionHistoryPage } from '../src/lib/ipc'
import type { Message } from '../src/types/session'

/**
 * Pins the hook itself, not just the pure merge helper. `session_ready` passes
 * `'merge'` because it has just cleared the list; every other caller passes
 * `'replace'` because what is still there is the previous view.
 */

type Setter = (updater: Message[] | ((previous: Message[]) => Message[])) => void
/** The signal setter, typed loosely so the stub does not have to mirror Solid's overloads. */
type SignalSetter = (value: Message[] | ((previous: Message[]) => Message[])) => void

let resolveRead: ((page: SessionHistoryPage) => void) | undefined
let getSessionMessages: ReturnType<typeof vi.fn>

const page = (messages: SessionHistoryMessage[]): SessionHistoryPage => ({
  messages,
  hasMoreBefore: false,
  nextBeforeEntryId: null,
  limit: 200,
})

function setup(getLeafId: () => string | null = () => null) {
  const [messages, setMessages] = createSignal<Message[]>([])
  let history!: ReturnType<typeof useSessionHistory>

  createRoot(() => {
    history = useSessionHistory({
      // SAFETY: createSignal's setter accepts exactly these shapes; only the generic
      // overloads differ from this test's loose signature.
      setMessages: setMessages as unknown as Setter,
      setError: () => {},
      getLeafId,
    })
  })

  return { messages, setMessages, history }
}

beforeEach(() => {
  const pending = new Promise<SessionHistoryPage>((resolve) => {
    resolveRead = resolve
  })
  getSessionMessages = vi.fn(() => pending)
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { ...globalThis.window, openpi: { getSessionMessages } },
  })
})

afterEach(() => {
  resolveRead = undefined
})

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('loadInitialMessages (#71)', () => {
  it('keeps a live message added while the read was in flight', async () => {
    const { messages, setMessages, history } = setup()
    history.loadInitialMessages('/tmp/s.jsonl', 'merge')

    // A resumed run emits its first output while the read is still open.
    setMessages([
      {
        id: 'a-2000',
        role: 'assistant',
        text: 'live output',
        toolCards: [],
        timestamp: 2_000,
      },
    ])

    resolveRead?.(
      page([{ id: 'entry-1', role: 'user', text: 'from file', toolCards: [], timestamp: 1_000 }])
    )
    await flush()

    expect(messages().map((message) => message.text)).toEqual(['from file', 'live output'])
  })

  it('does not duplicate a message the page also carries', async () => {
    const { messages, setMessages, history } = setup()
    history.loadInitialMessages('/tmp/s.jsonl', 'merge')

    setMessages([
      { id: 'u-1000', role: 'user', text: 'hello', toolCards: [], timestamp: 1_000 },
      { id: 'a-2000', role: 'assistant', text: 'reply', toolCards: [], timestamp: 2_000 },
    ])

    resolveRead?.(
      page([
        { id: 'entry-1', role: 'user', text: 'hello', toolCards: [], timestamp: 1_000 },
        { id: 'entry-2', role: 'assistant', text: 'reply', toolCards: [], timestamp: 2_000 },
      ])
    )
    await flush()

    expect(messages().map((message) => message.id)).toEqual(['entry-1', 'entry-2'])
  })

  it('shows only the file copy when the same messages also arrived live', async () => {
    const { messages, setMessages, history } = setup()
    history.loadInitialMessages('/tmp/s.jsonl', 'merge')
    setMessages([
      { id: 'u-1000', role: 'user', text: 'from file', toolCards: [], timestamp: 1_000 },
    ])

    resolveRead?.(
      page([{ id: 'entry-1', role: 'user', text: 'from file', toolCards: [], timestamp: 1_000 }])
    )
    await flush()

    expect(messages().map((message) => message.id)).toEqual(['entry-1'])
  })

  it('replaces the previous view, as branch navigation needs (#71)', async () => {
    // navigateTree sets a new leaf and reloads WITHOUT clearing messages, so the
    // list still holds the abandoned branch. Merging there would keep it.
    const { messages, setMessages, history } = setup()
    setMessages([
      { id: 'entry-e1', role: 'user', text: 'kept', toolCards: [], timestamp: 1_000 },
      { id: 'entry-e3', role: 'user', text: 'abandoned branch', toolCards: [], timestamp: 3_000 },
    ])
    history.loadInitialMessages('/tmp/s.jsonl', 'replace')

    resolveRead?.(
      page([{ id: 'entry-e1', role: 'user', text: 'kept', toolCards: [], timestamp: 1_000 }])
    )
    await flush()

    expect(messages().map((message) => message.text)).toEqual(['kept'])
  })

  it('ignores a page that lands after the session was switched away', async () => {
    const { messages, history } = setup()
    history.loadInitialMessages('/tmp/old.jsonl', 'merge')
    history.reset('/tmp/new.jsonl')

    resolveRead?.(page([{ id: 'entry-1', role: 'user', text: 'from old', toolCards: [] }]))
    await flush()

    expect(messages()).toEqual([])
  })
})
