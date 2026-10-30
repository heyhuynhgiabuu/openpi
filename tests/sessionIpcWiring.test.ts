import { createRoot } from 'solid-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  registerSessionIpc,
  type SessionIpcWiringDeps,
} from '../src/hooks/session/sessionIpcWiring'
import type { SessionReady } from '../src/lib/ipc'

/**
 * Pins the history mode `session_ready` passes. It has just cleared the message
 * list, so anything left in it came from the live stream and must survive the
 * read (#71). Flipping the argument broke no test before this.
 */

interface Stubs {
  loadInitialMessages: ReturnType<typeof vi.fn>
  reset: ReturnType<typeof vi.fn>
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
    git: { onStatusChanged: vi.fn(() => unsubscribe) },
    onSessionReady: (cb: (payload: SessionReady) => void) => {
      onReady = cb
      return unsubscribe
    },
  })

  const loadInitialMessages = vi.fn()
  const reset = vi.fn()
  const noop = vi.fn()

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
    sessionIndex: { setSelectedWorkspacePath: noop, loadSessionIndex: noop },
    trackers: { clearAll: noop },
    getReady: () => ({ cwd: '/tmp/ws' }),
    setReady: noop,
    setMessages: noop,
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
  } as unknown as SessionIpcWiringDeps

  createRoot(() => registerSessionIpc(deps))
  // onMount subscribes after the root's first pass.
  await Promise.resolve()

  return {
    loadInitialMessages,
    reset,
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

    expect(stubs.loadInitialMessages).toHaveBeenCalledWith('/tmp/s.jsonl', 'merge')
  })

  it('does not read history when there is no session file', async () => {
    const stubs = await setup()

    stubs.fireReady({ ...readyPayload(), sessionFile: null })

    expect(stubs.loadInitialMessages).not.toHaveBeenCalled()
  })
})
