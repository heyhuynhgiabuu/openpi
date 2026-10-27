import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createSessionEventHandle,
  type SessionEventPipeDeps,
} from '../src/hooks/session/sessionEventPipe'
import { useAgentRunMetrics } from '../src/hooks/useAgentRunMetrics'
import { useExtensionTrackers } from '../src/hooks/useExtensionTrackers'
import type { SessionEvent } from '../src/lib/ipc'
import type { Message } from '../src/types/session'
import {
  CODEMODE_CALL_ID,
  CODEMODE_RESULT_TEXT,
  codemodeToolEvents,
  codemodeTurnEvents,
  parseEvents,
} from './helpers/nestedToolEvents'

const disposers: Array<() => void> = []
afterEach(() => disposers.splice(0).forEach((dispose) => dispose()))

interface PipeState {
  messages: Message[]
  treeVersion: number
  streaming: boolean
}

/** The real pipe, trackers and run metrics; only the Solid setters are plain variables. */
function createPipe() {
  const state: PipeState = { messages: [], treeVersion: 0, streaming: false }
  const { handle, trackers } = createRoot((dispose) => {
    disposers.push(dispose)
    const trackers = useExtensionTrackers()
    const deps: SessionEventPipeDeps = {
      refs: {
        justSentPrompt: false,
        currentModelName: null,
        currentTurnStartMs: null,
        textareaEl: undefined,
      },
      refreshContextUsage: async () => {},
      remoteSync: { markLocalActivity: () => {} },
      agentRunMetrics: useAgentRunMetrics(),
      trackers,
      setIsStreaming: (value) => {
        state.streaming = value
      },
      setAwaitingPrompt: () => {},
      setQueueMode: () => {},
      setSteeringQueue: () => {},
      setFollowUpQueue: () => {},
      setSessionNameState: () => {},
      setMessages: (update) => {
        state.messages = update(state.messages)
      },
      setBranchLeafId: () => {},
      setTreeVersion: (update) => {
        state.treeVersion = update(state.treeVersion)
      },
    }
    return { handle: createSessionEventHandle(deps), trackers }
  })
  const feed = (events: SessionEvent[]) => events.forEach((event) => handle(event))
  const cards = () => state.messages.flatMap((m) => ('toolCards' in m ? m.toolCards : []))
  return { state, trackers, feed, cards }
}

describe('event pipe with codemode nested tool events', () => {
  it('folds a whole codemode turn into one tool card with its final result', () => {
    const { state, feed, cards } = createPipe()

    feed(codemodeTurnEvents())

    expect(cards().map((card) => card.toolCallId)).toEqual([CODEMODE_CALL_ID])
    expect(cards()[0]).toMatchObject({
      toolName: 'codemode',
      streaming: false,
      isError: false,
      output: CODEMODE_RESULT_TEXT,
    })
    expect(state.streaming).toBe(false)
  })

  it('keeps the run active and the codemode card running while a nested call ends', () => {
    const { state, feed, cards } = createPipe()
    const tool = codemodeToolEvents()
    const turn = codemodeTurnEvents()
    const beforeTools = turn.slice(
      0,
      turn.findIndex((e) => e.type === 'tool_execution_start')
    )

    feed(beforeTools)
    feed(parseEvents([tool.start, tool.nestedStart, tool.nestedEnd]))

    expect(state.streaming).toBe(true)
    expect(cards()).toHaveLength(1)
    expect(cards()[0]).toMatchObject({ toolCallId: CODEMODE_CALL_ID, streaming: true })
  })

  it('does not register a nested write as a pi-task row', () => {
    const { trackers, feed } = createPipe()

    feed(codemodeTurnEvents())

    expect(trackers.tasks()).toEqual([])
  })

  it('does not refresh the session tree for nested calls, which append no entry', () => {
    const { state, feed } = createPipe()
    const tool = codemodeToolEvents()

    feed(parseEvents([tool.start]))
    const before = state.treeVersion
    feed(parseEvents([tool.nestedStart, tool.nestedEnd]))

    expect(state.treeVersion).toBe(before)
  })
})
