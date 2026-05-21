import { createSignal } from 'solid-js'

export interface PromptHistory {
  historyIndex: () => number
  savedDraft: () => string
  setHistoryIndex: (idx: number | ((prev: number) => number)) => void
  setSavedDraft: (draft: string | ((prev: string) => string)) => void
  historyBack: () => void
  historyForward: () => void
  resetHistory: () => void
}

interface UsePromptHistoryConfig {
  input: () => string
  onInput: (val: string) => void
  promptHistory: () => string[]
}

export function usePromptHistory(config: UsePromptHistoryConfig): PromptHistory {
  // -1 = typing draft; ≥0 = browsing history (0 = most recent)
  const [historyIndex, setHistoryIndex] = createSignal(-1)
  const [savedDraft, setSavedDraft] = createSignal('')

  const historyBack = () => {
    const history = config.promptHistory()
    if (!history.length) return
    const current = historyIndex()
    if (current === -1) {
      // First Up press — save draft and go to most-recent message
      setSavedDraft(config.input())
      setHistoryIndex(0)
      config.onInput(history[0] ?? '')
    } else if (current < history.length - 1) {
      // Go further back
      setHistoryIndex(current + 1)
      config.onInput(history[current + 1] ?? '')
    }
    // At oldest entry — do nothing
  }

  const historyForward = () => {
    const current = historyIndex()
    if (current <= 0) {
      // Back to draft
      setHistoryIndex(-1)
      config.onInput(savedDraft())
    } else {
      setHistoryIndex(current - 1)
      config.onInput(config.promptHistory()[current - 1] ?? '')
    }
  }

  const resetHistory = () => {
    setHistoryIndex(-1)
    setSavedDraft('')
  }

  return {
    historyIndex,
    savedDraft,
    setHistoryIndex,
    setSavedDraft,
    historyBack,
    historyForward,
    resetHistory,
  }
}
