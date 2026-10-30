import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionActions, type SessionActionDeps } from '../src/hooks/session/sessionActions'

/**
 * Pins the history mode `navigateTree` passes. It reloads after moving the leaf
 * WITHOUT clearing, so the list still holds the abandoned branch — merging would
 * leave that branch on screen. Flipping the argument broke no test before this.
 */

afterEach(() => vi.unstubAllGlobals())

function setup(result: { cancelled: boolean; leafId: string | null; editorText?: string }) {
  const navigateSessionTree = vi.fn(async () => result)
  // Stub pattern from tests/extensionUiDialogExpiry.test.ts.
  vi.stubGlobal('openpi', { navigateSessionTree })

  const loadInitialMessages = vi.fn()
  const setBranchLeafId = vi.fn()
  const setInput = vi.fn()

  const deps = {
    refs: {
      justSentPrompt: false,
      currentModelName: null,
      currentTurnStartMs: null,
      textareaEl: undefined,
    },
    input: () => '',
    setInput,
    ready: () => ({ sessionFile: '/tmp/s.jsonl' }),
    queueMode: () => 'prompt' as const,
    isShellRunning: () => false,
    setIsShellRunning: vi.fn(),
    setCurrentModel: vi.fn(),
    setModels: vi.fn(),
    setError: vi.fn(),
    setMessages: vi.fn(),
    setThinkingLevelState: vi.fn(),
    setSessionNameState: vi.fn(),
    setBranchLeafId,
    refreshContextUsage: vi.fn(async () => {}),
    remoteSync: { markLocalActivity: vi.fn() },
    sessionHistory: { loadInitialMessages },
  } as unknown as SessionActionDeps

  return { actions: createSessionActions(deps), loadInitialMessages, setInput, navigateSessionTree }
}

describe('navigateTree history mode (#71)', () => {
  it('replaces, because the abandoned branch is still on screen', async () => {
    const { actions, loadInitialMessages } = setup({
      cancelled: false,
      leafId: 'e1',
      editorText: 'hi',
    })

    await actions.navigateTree('e1')

    expect(loadInitialMessages).toHaveBeenCalledWith('/tmp/s.jsonl', 'replace')
  })

  it('does not reload when the navigation was cancelled', async () => {
    const { actions, loadInitialMessages } = setup({ cancelled: true, leafId: null })

    await actions.navigateTree('e1')

    expect(loadInitialMessages).not.toHaveBeenCalled()
  })
})
