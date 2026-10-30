import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerSessionIpc,
  type SessionIpcWiringDeps,
} from '../src/hooks/session/sessionIpcWiring'
import { useExtensionTrackers } from '../src/hooks/useExtensionTrackers'
import { useSessionIndex } from '../src/hooks/useSessionIndex'
import type { SessionReady } from '../src/lib/ipc'
import type { Message } from '../src/types/session'

/**
 * Pins the history mode `session_ready` passes. It has just cleared the message
 * list, so anything left in it came from the live stream and must survive the
 * read (#71). Flipping the argument broke no test before this.
 */

interface Stubs {
  loadInitialMessages: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
  setMessages: ReturnType<typeof vi.fn>
  fireReady: (payload: SessionReady) => void
}

afterEach(() => {
  vi.unstubAllGlobals()
})

async function setup(): Promise<Stubs> {
  let onReady: ((payload: SessionReady) => void) | undefined
  const unsubscribe = () => {}

  vi.stubGlobal('openpi', {
    onSessionEvent: vi.fn(() => unsubscribe),
    onRemoteSessionStatus: vi.fn(() => unsubscribe),
    onRemoteSessionUpdate: vi.fn(() => unsubscribe),
    onSessionError: vi.fn(() => unsubscribe),
    onSessionIndexUpdated: vi.fn(() => unsubscribe),
    getWorkspaceSummary: vi.fn(async () => ({ branch: null })),
    // The real useSessionIndex hook is used below, so its own loads must resolve.
    getWorkspaces: vi.fn(async () => []),
    getSessions: vi.fn(async () => []),
    git: { onStatusChanged: vi.fn(() => unsubscribe) },
    onSessionReady: (cb: (payload: SessionReady) => void) => {
      onReady = cb
      return unsubscribe
    },
  })

  const loadInitialMessages = vi.fn()
  const reset = vi.fn()
  const setMessages = vi.fn<(update: (previous: Message[]) => Message[]) => void>()
  const noop = vi.fn()

  // The real hooks rather than partial stubs, so the deps object type-checks without a cast.
  const sessionIndex = useSessionIndex(() => '/tmp/ws')
  const trackers = useExtensionTrackers()

  const deps = {
    refs: {
      justSentPrompt: false,
      currentModelName: null,
      currentTurnStartMs: null,
      textareaEl: undefined,
    },
    handleEvent: noop,
    refreshContextUsage: noop,
    remoteSync: { handleRemoteSessionStatus: noop, handleRemoteSessionUpdate: noop },
    sessionHistory: { reset, loadInitialMessages },
    sessionIndex,
    trackers,
    getReady: readyPayload,
    setReady: noop,
    setMessages,
    setError: noop,
    setSteeringQueue: noop,
    setFollowUpQueue: noop,
    setAwaitingPrompt: noop,
    setSessionNameState: noop,
    setCurrentModel: noop,
    setThinkingLevelState: noop,
    setIsStreaming: noop,
    setBranchLeafId: noop,
    setContextPercent: noop,
    setWorkspaceSummary: noop,
    setGitBranch: noop,
    setGitStats: noop,
  } satisfies SessionIpcWiringDeps

  createRoot(() => registerSessionIpc(deps))
  // onMount subscribes after the root's first pass.
  await Promise.resolve()

  return {
    loadInitialMessages,
    reset,
    setMessages,
    fireReady: (payload) => {
      if (!onReady) throw new Error('onSessionReady was never subscribed')
      onReady(payload)
    },
  }
}

const readyPayload = (): SessionReady => ({
  cwd: '/tmp/ws',
  sessionFile: '/tmp/s.jsonl',
  sessionId: 's1',
  sessionName: null,
  model: null,
  thinkingLevel: null,
})

describe('session_ready history mode (#71)', () => {
  it('merges, because a live message can land while the read is in flight', async () => {
    const stubs = await setup()

    stubs.fireReady(readyPayload())

    expect(stubs.loadInitialMessages.mock.calls).toEqual([['/tmp/s.jsonl', 'merge']])
  })

  it('clears the list first, which is what makes merging safe here', async () => {
    // 'merge' is only correct because the list was just emptied: whatever remains
    // when the read resolves is genuinely from the live stream, not the previous
    // view. If this clear goes away, merge starts keeping stale messages again.
    const stubs = await setup()

    stubs.fireReady(readyPayload())

    // Probe with a NON-empty list: an updater that merely returns an empty list for
    // an empty one (keep everything, keep some) would pass an empty-list probe while
    // leaving stale messages on screen.
    // One of each role, so a filter that keeps only some roles is not mistaken for a clear.
    const stale: Message[] = [
      { id: 'stale-u', role: 'user', text: 'previous view', toolCards: [] },
      { id: 'stale-a', role: 'assistant', text: 'previous view', toolCards: [] },
    ]
    const clearIndexes = stubs.setMessages.mock.calls.flatMap((call, index) =>
      call[0](stale).length === 0 ? [index] : []
    )
    expect(clearIndexes).toHaveLength(1)

    // And that clear must happen before the read is requested.
    const clearOrder = stubs.setMessages.mock.invocationCallOrder[clearIndexes[0] ?? 0] ?? 0
    expect(clearOrder).toBeLessThan(stubs.loadInitialMessages.mock.invocationCallOrder[0] ?? 0)
  })

  it('does not read history when there is no session file', async () => {
    const stubs = await setup()

    stubs.fireReady({ ...readyPayload(), sessionFile: null })

    expect(stubs.loadInitialMessages).not.toHaveBeenCalled()
  })
})
