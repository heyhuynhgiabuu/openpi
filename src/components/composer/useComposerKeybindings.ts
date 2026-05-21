import { type Accessor, createSignal, onCleanup, onMount } from 'solid-js'
import {
  buildKeybindingEntries,
  eventMatchesBinding,
  findBinding,
  KEYBINDINGS_CHANGED_EVENT,
  type KeybindingActionId,
  type KeybindingOverrides,
  loadCustomKeybindings,
} from '../../lib/keybindings'
import { THINKING_LEVELS } from './helpers'

interface KeybindingConfig {
  input: Accessor<string>
  isStreaming: Accessor<boolean>
  shellMode: Accessor<boolean>
  setShellMode: (v: boolean) => void
  setPickerOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  modelOpen: Accessor<boolean>
  setModelOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  setThinkingOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  modelSearchRef: Accessor<HTMLInputElement | undefined>
  textareaEl: Accessor<HTMLTextAreaElement | undefined>
  closeFileMentionPicker: () => void
  setSlashOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  setSkillOpen: (v: boolean | ((prev: boolean) => boolean)) => void
  thinkingLevel: string
  onThinkingLevel: (level: string) => void
  onInput: (val: string) => void
  onQueueMode: (fn: (m: string) => string) => void
}

export function useComposerKeybindings(config: KeybindingConfig): Accessor<KeybindingOverrides> {
  const [customKeybindings, setCustomKeybindings] = createSignal<KeybindingOverrides>({})

  onMount(() => {
    loadCustomKeybindings()
      .then(setCustomKeybindings)
      .catch(() => {})

    const onKeybindingsChanged = (event: Event) => {
      setCustomKeybindings((event as CustomEvent<KeybindingOverrides>).detail)
    }
    window.addEventListener(KEYBINDINGS_CHANGED_EVENT, onKeybindingsChanged)

    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('[role="dialog"], .customizations-modal')) return

      const entries = buildKeybindingEntries(customKeybindings())
      const b = (actionId: KeybindingActionId) => findBinding(entries, actionId)

      if (eventMatchesBinding(event, b('addFiles'))) {
        event.preventDefault()
        config.setPickerOpen((v) => !v)
        config.setModelOpen(false)
        config.setThinkingOpen(false)
        return
      }
      if (eventMatchesBinding(event, b('toggleShellMode'))) {
        event.preventDefault()
        config.setShellMode(true)
        config.setPickerOpen(false)
        config.setModelOpen(false)
        config.setThinkingOpen(false)
        config.setSlashOpen(false)
        config.setSkillOpen(false)
        config.closeFileMentionPicker()
        requestAnimationFrame(() => config.textareaEl()?.focus())
        return
      }
      if (eventMatchesBinding(event, b('chooseModel'))) {
        event.preventDefault()
        const willOpen = !config.modelOpen()
        config.setModelOpen(willOpen)
        config.setThinkingOpen(false)
        config.setPickerOpen(false)
        if (willOpen) setTimeout(() => config.modelSearchRef()?.focus(), 30)
        return
      }
      if (eventMatchesBinding(event, b('cycleThinkingEffort'))) {
        event.preventDefault()
        const currentIndex = THINKING_LEVELS.indexOf(
          config.thinkingLevel as (typeof THINKING_LEVELS)[number]
        )
        const nextIndex = currentIndex === -1 ? 0 : (currentIndex + 1) % THINKING_LEVELS.length
        config.onThinkingLevel(THINKING_LEVELS[nextIndex])
        return
      }
      if (eventMatchesBinding(event, b('focusComposer'))) {
        event.preventDefault()
        requestAnimationFrame(() => config.textareaEl()?.focus())
        return
      }
      if (eventMatchesBinding(event, b('clearInput'))) {
        const active = document.activeElement
        if (active === config.textareaEl()) {
          const el = config.textareaEl()
          const sel = el?.selectionStart !== el?.selectionEnd
          if (!sel && config.input().length > 0) {
            event.preventDefault()
            config.onInput('')
            return
          }
        }
      }
      if (eventMatchesBinding(event, b('steerMode')) && config.isStreaming()) {
        event.preventDefault()
        config.onQueueMode((m: string) => (m === 'steer' ? 'prompt' : 'steer'))
        requestAnimationFrame(() => config.textareaEl()?.focus())
        return
      }
      if (eventMatchesBinding(event, b('followupMode')) && config.isStreaming()) {
        event.preventDefault()
        config.onQueueMode((m: string) => (m === 'followup' ? 'prompt' : 'followup'))
        requestAnimationFrame(() => config.textareaEl()?.focus())
        return
      }
    }

    window.addEventListener('keydown', handler)
    onCleanup(() => {
      window.removeEventListener('keydown', handler)
      window.removeEventListener(KEYBINDINGS_CHANGED_EVENT, onKeybindingsChanged)
    })
  })

  return customKeybindings
}
