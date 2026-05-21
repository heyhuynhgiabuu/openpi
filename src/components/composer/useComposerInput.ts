import type { Accessor } from 'solid-js'
import type { FileMentionTrigger } from '../../lib/fileMentions'

interface InputConfig {
  shellMode: Accessor<boolean>
  historyIndex: Accessor<number>
  setHistoryIndex: (idx: number | ((prev: number) => number)) => void
  slashOpen: Accessor<boolean>
  setSlashOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  setSlashQuery: (q: string | ((prev: string) => string)) => void
  skillOpen: Accessor<boolean>
  setSkillOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  setSkillQuery: (q: string | ((prev: string) => string)) => void
  textareaEl: Accessor<HTMLTextAreaElement | undefined>
  onInput: (val: string) => void
  updateFileMentionPicker: (value: string, cursor: number) => FileMentionTrigger | null
  closeFileMentionPicker: () => void
}

export function useComposerInput(config: InputConfig) {
  return (event: Event) => {
    const el = event.currentTarget as HTMLTextAreaElement
    const val = el.value
    const caret = el.selectionStart ?? val.length
    config.onInput(val)
    // Any direct typing exits history-browsing mode
    if (config.historyIndex() !== -1) config.setHistoryIndex(-1)

    if (config.shellMode()) {
      if (config.slashOpen()) config.setSlashOpen(false)
      if (config.skillOpen()) config.setSkillOpen(false)
      config.closeFileMentionPicker()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`
      return
    }

    const mention = config.updateFileMentionPicker(val, caret)
    if (mention) {
      if (config.slashOpen()) config.setSlashOpen(false)
      if (config.skillOpen()) config.setSkillOpen(false)
    }

    // Skill picker: /skill:<query> takes priority over slash picker
    const skillMatch = mention ? null : /^\/skill:([\w-]*)$/.exec(val)
    // Slash command detection: entire input is exactly /<query>
    const slashMatch = !mention && !skillMatch ? /^\/([-\w]*)$/.exec(val) : null

    if (skillMatch !== null) {
      config.setSkillQuery(skillMatch[1] ?? '')
      config.setSkillOpen(true)
      if (config.slashOpen()) config.setSlashOpen(false)
      config.closeFileMentionPicker()
    } else if (slashMatch !== null) {
      config.setSlashQuery(slashMatch[1] ?? '')
      config.setSlashOpen(true)
      if (config.skillOpen()) config.setSkillOpen(false)
      config.closeFileMentionPicker()
    } else if (!mention) {
      if (config.slashOpen()) config.setSlashOpen(false)
      if (config.skillOpen()) config.setSkillOpen(false)
    }

    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }
}
