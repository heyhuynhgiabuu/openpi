import type { FffFileResult, SkillItem } from '../../lib/ipc'
import type { SlashCommand } from './types'

interface KeyboardConfig {
  shellMode: () => boolean
  // Shell mode
  setShellMode: (v: boolean) => void
  onShellSend: () => void

  // Is streaming
  isStreaming: () => boolean
  input: () => string
  promptHistoryLength: () => number

  // Picker state
  fileMentionOpen: () => boolean
  fileMentionResults: () => FffFileResult[]
  fileMentionActiveIdx: () => number
  filteredAgents: () => { name: string; description: string }[]
  slashOpen: () => boolean
  filteredCmds: () => SlashCommand[]
  slashActiveIdx: () => number
  skillOpen: () => boolean
  filteredSkills: () => SkillItem[]
  skillActiveIdx: () => number

  // History state
  historyIndex: () => number

  // Picker actions
  applyFileMention: (file: FffFileResult) => void
  applyAgentMention: (name: string) => void
  applySlashCommand: (cmd: SlashCommand) => void
  applySkill: (skill: SkillItem) => void
  closeFileMentionPicker: () => void
  setFileMentionActiveIdx: (idx: number | ((prev: number) => number)) => void
  setSlashActiveIdx: (idx: number | ((prev: number) => number)) => void
  setSlashOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  setSkillActiveIdx: (idx: number | ((prev: number) => number)) => void
  setSkillOpen: (v: boolean | ((prev: boolean) => boolean)) => void

  // History actions
  setHistoryIndex: (idx: number | ((prev: number) => number)) => void
  setSavedDraft: (draft: string | ((prev: string) => string)) => void
  historyBack: () => void
  historyForward: () => void

  // Send
  handleSend: () => void
  onQueueMode: (mode: string | ((prev: string) => string)) => void
}

export function useComposerTextareaKeyboard(config: KeyboardConfig) {
  return (event: KeyboardEvent) => {
    const currentMentionResults = config.fileMentionResults()
    const currentFilteredCmds = config.filteredCmds()
    const currentFilteredSkills = config.filteredSkills()

    if (config.shellMode()) {
      if (event.key === 'Escape') {
        event.preventDefault()
        config.setShellMode(false)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
        event.preventDefault()
        config.onShellSend()
        return
      }
    }

    // Inline @ mention picker intercepts navigation keys first
    if (config.fileMentionOpen()) {
      const agentResults = config.filteredAgents()
      const totalItems = agentResults.length + currentMentionResults.length
      const activeIdx = config.fileMentionActiveIdx()
      if (event.key === 'ArrowDown' && totalItems > 0) {
        event.preventDefault()
        config.setFileMentionActiveIdx((i) => Math.min(i + 1, totalItems - 1))
        return
      }
      if (event.key === 'ArrowUp' && totalItems > 0) {
        event.preventDefault()
        config.setFileMentionActiveIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        if (activeIdx < agentResults.length) {
          const agent = agentResults[activeIdx]
          if (agent) config.applyAgentMention(agent.name)
        } else {
          const fileIdx = activeIdx - agentResults.length
          const file = currentMentionResults[fileIdx]
          if (file) config.applyFileMention(file)
        }
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        config.closeFileMentionPicker()
        return
      }
    }

    // Slash picker intercepts navigation keys first
    if (config.slashOpen() && currentFilteredCmds.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        config.setSlashActiveIdx((i) => Math.min(i + 1, currentFilteredCmds.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        config.setSlashActiveIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const cmd = currentFilteredCmds[config.slashActiveIdx()]
        if (cmd) config.applySlashCommand(cmd)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        config.setSlashOpen(false)
        return
      }
    }

    // Skill picker keyboard nav
    if (config.skillOpen() && currentFilteredSkills.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        config.setSkillActiveIdx((i) => Math.min(i + 1, currentFilteredSkills.length - 1))
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        config.setSkillActiveIdx((i) => Math.max(i - 1, 0))
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        const s = currentFilteredSkills[config.skillActiveIdx()]
        if (s) config.applySkill(s)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        config.setSkillOpen(false)
        return
      }
    }

    // ─ Prompt history navigation (Up/Down) ───────────────────────────────
    // Up at the start enters prompt history; while browsing, Up keeps going older.
    if (
      event.key === 'ArrowUp' &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !config.shellMode() &&
      !config.slashOpen() &&
      !config.skillOpen() &&
      !config.fileMentionOpen() &&
      (config.historyIndex() !== -1 ||
        (event.currentTarget instanceof HTMLTextAreaElement &&
          event.currentTarget.selectionStart === 0 &&
          event.currentTarget.selectionEnd === 0))
    ) {
      event.preventDefault()
      config.historyBack()
      requestAnimationFrame(() => {
        if (event.currentTarget instanceof HTMLTextAreaElement) {
          const len = event.currentTarget.value.length
          event.currentTarget.setSelectionRange(len, len)
          event.currentTarget.style.height = 'auto'
          event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 200)}px`
        }
      })
      return
    }

    // Down when browsing history → move forward toward draft
    if (
      event.key === 'ArrowDown' &&
      !event.shiftKey &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey &&
      !config.shellMode() &&
      config.historyIndex() !== -1
    ) {
      event.preventDefault()
      config.historyForward()
      requestAnimationFrame(() => {
        if (event.currentTarget instanceof HTMLTextAreaElement) {
          const len = event.currentTarget.value.length
          event.currentTarget.setSelectionRange(len, len)
          event.currentTarget.style.height = 'auto'
          event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 200)}px`
        }
      })
      return
    }

    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      // Reset history cursor so next Up starts at most-recent message again
      config.setHistoryIndex(-1)
      config.setSavedDraft('')
      config.handleSend()
    }

    if (event.key === 'Enter' && event.altKey && config.isStreaming()) {
      event.preventDefault()
      config.onQueueMode((current: string) =>
        current === 'prompt' ? 'steer' : current === 'steer' ? 'followup' : 'prompt'
      )
    }
  }
}
