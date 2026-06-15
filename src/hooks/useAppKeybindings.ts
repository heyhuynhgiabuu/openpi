import { createMemo } from 'solid-js'
import type { PaletteCommand } from '../components/CommandPalette'
import {
  buildKeybindingEntries,
  eventMatchesBinding,
  findBinding,
  type KeybindingActionId,
  type KeybindingOverrides,
} from '../lib/keybindings'

interface UseAppKeybindingsOptions {
  customKeybindings: () => KeybindingOverrides
  setCommandPaletteOpen: (open: boolean) => void
  setTerminalOpen: (fn: (prev: boolean) => boolean) => void
  setNewTerminalRequest: (fn: (prev: number) => number) => void
  setRightPanelOpen: (fn: (prev: boolean) => boolean) => void
  setFileSearchOpen: (open: boolean) => void
  setFileFindOpen: (open: boolean) => void
  setCustomizationsOpen: (open: boolean) => void
  openFiles: () => string[]
  activeFileIdx: () => number
  closeFile: (idx: number) => void
  triggerRename: (() => void) | undefined
  isStreaming: () => boolean
  createNewSession: () => Promise<void>
  openWorkspace: () => Promise<void>
}

export function useAppKeybindings(options: UseAppKeybindingsOptions) {
  const requestFileFind = () => {
    options.setFileFindOpen(false)
    queueMicrotask(() => options.setFileFindOpen(true))
  }

  const paletteCommands = createMemo<PaletteCommand[]>(() => {
    const entries = new Map(
      buildKeybindingEntries(options.customKeybindings()).map((entry) => [entry.id, entry])
    )
    const command = (id: KeybindingActionId, run: () => void): PaletteCommand | null => {
      const entry = entries.get(id)
      if (!entry) return null
      return {
        id,
        label: entry.label,
        description: entry.description,
        keys: entry.keys,
        run,
      }
    }

    return [
      command('newSession', () => void options.createNewSession()),
      command('openFileSearch', () => {
        options.setRightPanelOpen(() => true)
        options.setFileSearchOpen(true)
      }),
      command('closeFileTab', () => {
        if (options.openFiles().length > 0) options.closeFile(options.activeFileIdx())
      }),
      command('searchInFile', () => {
        requestFileFind()
      }),
      command('openCustomizations', () => options.setCustomizationsOpen(true)),
      command('openProject', () => void options.openWorkspace()),
      command('renameSession', () => options.triggerRename?.()),
      command('toggleSidebar', () => {}),
      command('toggleGitPanel', () => options.setRightPanelOpen((prev) => !prev)),
      command('toggleFileTree', () => options.setRightPanelOpen((prev) => !prev)),
      command('toggleTerminal', () => {
        options.setTerminalOpen((prev) => {
          if (!prev) options.setNewTerminalRequest((n) => n + 1)
          return !prev
        })
      }),
      command('newTerminal', () => {
        options.setTerminalOpen(() => true)
        options.setNewTerminalRequest((prev) => prev + 1)
      }),
    ].filter((item): item is PaletteCommand => item != null)
  })

  const setupKeydownHandler = (): (() => void) => {
    const onKeyDown = (event: KeyboardEvent) => {
      const activeBindings = buildKeybindingEntries(options.customKeybindings())
      const binding = (actionId: KeybindingActionId) => findBinding(activeBindings, actionId)
      const target = event.target as HTMLElement | null
      const inDialog = Boolean(target?.closest('[role="dialog"], .customizations-modal'))
      const inTextInput = Boolean(
        target?.closest('input, textarea, select, [contenteditable="true"]')
      )
      const allowFromInput = event.metaKey || event.ctrlKey || event.altKey

      if (eventMatchesBinding(event, binding('openCommandPalette'))) {
        event.preventDefault()
        options.setCommandPaletteOpen(true)
        return
      }
      if (inDialog) return
      if (inTextInput && !allowFromInput && !eventMatchesBinding(event, binding('interruptAgent')))
        return

      if (eventMatchesBinding(event, binding('interruptAgent')) && options.isStreaming()) {
        event.preventDefault()
        void window.openpi.abort()
        return
      }
      if (eventMatchesBinding(event, binding('newSession'))) {
        event.preventDefault()
        void options.createNewSession()
        return
      }
      if (eventMatchesBinding(event, binding('toggleTerminal'))) {
        event.preventDefault()
        options.setTerminalOpen((prev) => {
          if (!prev) options.setNewTerminalRequest((n) => n + 1)
          return !prev
        })
        return
      }
      if (eventMatchesBinding(event, binding('newTerminal'))) {
        event.preventDefault()
        options.setTerminalOpen(() => true)
        options.setNewTerminalRequest((prev) => prev + 1)
        return
      }
      if (eventMatchesBinding(event, binding('toggleSidebar'))) {
        event.preventDefault()
        return
      }
      if (eventMatchesBinding(event, binding('toggleGitPanel'))) {
        event.preventDefault()
        options.setRightPanelOpen((prev) => !prev)
        return
      }
      if (eventMatchesBinding(event, binding('toggleFileTree'))) {
        event.preventDefault()
        options.setRightPanelOpen((prev) => !prev)
        return
      }
      if (eventMatchesBinding(event, binding('openFileSearch'))) {
        event.preventDefault()
        options.setRightPanelOpen(() => true)
        options.setFileSearchOpen(true)
        return
      }
      if (eventMatchesBinding(event, binding('closeFileTab'))) {
        if (options.openFiles().length > 0) {
          event.preventDefault()
          options.closeFile(options.activeFileIdx())
        }
        return
      }
      if (eventMatchesBinding(event, binding('searchInFile'))) {
        event.preventDefault()
        requestFileFind()
        return
      }
      if (eventMatchesBinding(event, binding('openCustomizations'))) {
        event.preventDefault()
        options.setCustomizationsOpen(true)
        return
      }
      if (eventMatchesBinding(event, binding('openProject'))) {
        event.preventDefault()
        void options.openWorkspace()
        return
      }
      if (eventMatchesBinding(event, binding('renameSession'))) {
        event.preventDefault()
        options.triggerRename?.()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }

  return {
    paletteCommands,
    setupKeydownHandler,
  }
}
