import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../src/lib/ipc'
import type { Message } from '../src/types/session'
import { EMPTY_RUN_USAGE } from '../src/lib/runUsage'
import {
  createSessionEventHandle,
  type SessionEventPipeDeps,
} from '../src/hooks/session/sessionEventPipe'

describe('event pipe refreshes on entry_appended', () => {
  function createDeps() {
    const messages: Message[] = []
    let treeVersion = 0
    let branchLeafCleared = false
    const deps = createPipeDeps({
      setTreeVersion: () => {
        treeVersion += 1
      },
      setBranchLeafId: () => {
        branchLeafCleared = true
      },
      setMessages: (update) => {
        update(messages)
      },
    })
    return { deps, messages, version: () => treeVersion, cleared: () => branchLeafCleared }
  }

  it('bumps the tree version and clears the branch leaf without touching messages', () => {
    const { deps, messages, version, cleared } = createDeps()
    const handle = createSessionEventHandle(deps)

    const before = [...messages]
    const event: SessionEvent = { type: 'entry_appended', entry: { type: 'usage', id: 'w1' } }
    handle(event)

    expect(version()).toBe(1)
    expect(cleared()).toBe(true)
    expect(messages).toEqual(before)
  })

  it('still refreshes on message_start (regression guard)', () => {
    const { deps, version } = createDeps()
    const handle = createSessionEventHandle(deps)
    handle({ type: 'message_start', message: { role: 'user', content: 'hi' } })
    expect(version()).toBe(1)
  })
})

function createPipeDeps(overrides: {
  setTreeVersion: (update: (version: number) => number) => void
  setBranchLeafId: (value: string | null) => void
  setMessages: (update: (previous: Message[]) => Message[]) => void
}): SessionEventPipeDeps {
  return {
    refs: {
      justSentPrompt: false,
      currentModelName: null,
      currentTurnStartMs: null,
      textareaEl: undefined,
    },
    refreshContextUsage: async () => {},
    remoteSync: { markLocalActivity: () => {} },
    agentRunMetrics: {
      tps: () => null,
      usage: () => EMPTY_RUN_USAGE,
      start: () => {},
      addTurn: () => {},
      finish: () => {},
    },
    trackers: {
      dispatchEvent: () => true,
      clearFinished: () => {},
    },
    setIsStreaming: () => {},
    setAwaitingPrompt: () => {},
    setQueueMode: () => {},
    setSteeringQueue: () => {},
    setFollowUpQueue: () => {},
    setSessionNameState: () => {},
    setMessages: overrides.setMessages,
    setBranchLeafId: overrides.setBranchLeafId,
    setTreeVersion: overrides.setTreeVersion,
  }
}
