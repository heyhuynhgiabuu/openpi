/**
 * Global app listeners and persisted-preference loading, registered once when
 * App mounts. Owns the document-level slash-command events that let commands
 * like /resume or /settings open overlays without threading props.
 */

import { onMount } from 'solid-js'
import type { useAppArchive } from '../hooks/useAppArchive'
import type { useAppKeybindings } from '../hooks/useAppKeybindings'
import type { useAppPrefs } from '../hooks/useAppPrefs'
import type { useOpenPiSession } from '../hooks/useOpenPiSession'

export interface AppGlobalListenerDeps {
  session: ReturnType<typeof useOpenPiSession>
  archive: ReturnType<typeof useAppArchive>
  appPrefs: ReturnType<typeof useAppPrefs>
  keybindings: ReturnType<typeof useAppKeybindings>
  setHiddenModels: (value: Set<string>) => void
  setFileFindOpen: (value: boolean) => void
  setHomescreenOpen: (value: boolean) => void
  setCustomizationsOpen: (value: boolean) => void
  setCustomizationsInitialTab: (value: string | undefined) => void
}

export function registerAppGlobalListeners(deps: AppGlobalListenerDeps): void {
  onMount(() => {
    // Load persisted prefs
    deps.archive.loadPersistedPrefs()
    window.openpi
      .getPref('hidden_models')
      .then((v) => {
        if (v) {
          try {
            deps.setHiddenModels(new Set(JSON.parse(v) as string[]))
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {})

    const removePrefs = deps.appPrefs.setupOnMount()
    const removeKeydown = deps.keybindings.setupKeydownHandler()
    const removeFileFindShortcut = window.openpi.onFileFindShortcut(() => {
      deps.setFileFindOpen(false)
      queueMicrotask(() => deps.setFileFindOpen(true))
    })

    // Allow slash commands (e.g. /resume) to open the homescreen
    // overlay without threading a new prop through the entire tree.
    const openHomescreenViaEvent = () => deps.setHomescreenOpen(true)
    document.addEventListener('openpi:open-homescreen', openHomescreenViaEvent)

    // Allow slash commands (e.g. /settings) to open the customizations
    // modal directly to a specific tab. The event detail carries the
    // tab key (e.g. "settings", "extensions", "themes").
    const openCustomizationsViaEvent = (event: Event) => {
      const tab = (event as CustomEvent<{ tab?: string }>).detail?.tab
      if (tab === 'settings' || tab === 'general' || tab === 'keybindings') {
        deps.setCustomizationsInitialTab(tab)
      } else {
        deps.setCustomizationsInitialTab(undefined)
      }
      deps.setCustomizationsOpen(true)
    }
    document.addEventListener('openpi:open-customizations', openCustomizationsViaEvent)

    return () => {
      removePrefs()
      removeKeydown()
      removeFileFindShortcut?.()
      document.removeEventListener('openpi:open-homescreen', openHomescreenViaEvent)
      document.removeEventListener('openpi:open-customizations', openCustomizationsViaEvent)
    }
  })
}
